import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, initialChallenge, startAuthentication } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

async function seedRealmAndUser(
  tx: RealmScopedDatabase,
  realmId: string,
  username: string,
  password: string,
): Promise<string> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await provisionBrowserFlow(tx, realmId);
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, realmId, username });
  await tx.insert(userCredentials).values({
    id: newId(),
    realmId,
    subjectId: subject.id,
    type: 'password',
    secretData: await hashPassword(password),
  });
  return subject.id;
}

describe('[ODUDU-AUTHN-FLOW-ORDER-01] a realm dispatches its own ordered executions', () => {
  it('offers password, not passkey, as the first applicable execution', async () => {
    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      await provisionBrowserFlow(tx, realmId);
    });

    // BROWSER_FLOW_DEFAULT lists passkey before password in the same
    // alternative group; getting password back rather than passkey is what
    // proves passkey inapplicable, not merely unpicked.
    const challenge = await withRealm(app.db, realmId, (tx) => initialChallenge(tx, realmId));
    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });

  it('completes after a correct password rather than challenging otp', async () => {
    const realmId = newId();
    const password = 'correct-horse-battery-staple';
    const subjectId = await withRealm(app.db, realmId, (tx) =>
      seedRealmAndUser(tx, realmId, 'ada', password),
    );

    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, realmId, request);
      return id;
    });

    // otp is a conditional execution in BROWSER_FLOW_DEFAULT; getting
    // 'success' rather than a second challenge is what proves it
    // inapplicable for this subject, since a conditional applicable
    // execution would be offered next instead.
    const result = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(result).toEqual({ kind: 'success', subjectId });
  });

  it('persists nothing for a factor that finishes the login, so a retry re-runs it', async () => {
    const realmId = newId();
    const password = 'correct-horse-battery-staple';
    const subjectId = await withRealm(app.db, realmId, (tx) =>
      seedRealmAndUser(tx, realmId, 'ada', password),
    );

    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, realmId, request);
      return id;
    });

    const first = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(first).toEqual({ kind: 'success', subjectId });

    // Nothing was written: password was the login's last factor, and a
    // retry (an id_token_hint mismatch, an unverified email — both leave
    // the session unconsumed downstream of this function) has to re-run it
    // exactly as the first attempt did, not find it already satisfied.
    const record = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.satisfied).toEqual([]);

    const second = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(second).toEqual({ kind: 'success', subjectId });
  });
});

describe('[ODUDU-AUTHN-SATISFIED-PERSISTENCE-01] satisfied executions round-trip and stay realm-scoped', () => {
  it('records an authenticator as satisfied and reads it back', async () => {
    const realmId = newId();
    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      const { authSessionId: id } = await startAuthentication(tx, realmId, request);
      return id;
    });

    const before = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(before?.satisfied).toEqual([]);

    await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).recordSatisfied(authSessionId, 'password'),
    );

    const after = await withRealm(app.db, realmId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(after?.satisfied).toEqual(['password']);
  });

  it('cannot record satisfied progress under a different realm context, and leaves it unaffected', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
        const { authSessionId } = await startAuthentication(tx, realmId, request);
        return authSessionId;
      },
      verifySeeded: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.satisfied).toEqual([]);
      },
      attempt: async (tx, authSessionId) =>
        authenticationSessionRepository(tx).recordSatisfied(authSessionId, 'password'),
      expectBlocked: () => {
        // An UPDATE affecting zero rows under a foreign realm context, not
        // a thrown error or a returned value — verifyRealmAUnaffected is
        // where the blocking actually shows.
      },
      verifyRealmAUnaffected: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.satisfied).toEqual([]);
      },
    });
  });
});

describe('[ODUDU-AUTHN-SESSION-EXPIRY-UNCHANGED-01] expiry is checked before the registry runs', () => {
  it('still refuses an expired authentication session', async () => {
    const realmId = newId();
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));

    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      await provisionBrowserFlow(tx, realmId);
      return (await startAuthentication(tx, realmId, request, clock)).authSessionId;
    });

    clock.advance(31 * 60_000);

    const result = await withRealm(app.db, realmId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: 'x' }, clock),
    );
    expect(result).toEqual({ kind: 'failure', reason: 'authentication_session_expired' });
  });
});
