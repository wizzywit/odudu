import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advance,
  establishSession,
  loadPendingRequest,
  startAuthentication,
} from '#/usecase/executor';
import { type PendingRequest } from '#/schema/authentication-sessions';

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
  scope: 'openid profile',
  state: 'xyz',
  nonce: 'abc',
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

describe('[ODUDU-AUTHN-REQUEST-PARKING-01] the request is parked server-side, not carried by the browser', () => {
  it('returns an opaque id that does not contain the request', async () => {
    const realmId = newId();
    const { authSessionId } = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      return startAuthentication(tx, realmId, request);
    });

    expect(authSessionId).not.toContain(request.redirectUri);
    expect(authSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('reads the parked request back unchanged', async () => {
    const realmId = newId();
    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      return (await startAuthentication(tx, realmId, request)).authSessionId;
    });

    const loaded = await withRealm(app.db, realmId, async (tx) =>
      loadPendingRequest(tx, authSessionId),
    );
    expect(loaded).toEqual(request);
  });

  it('refuses an expired authentication session', async () => {
    const realmId = newId();
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));

    const authSessionId = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      return (await startAuthentication(tx, realmId, request, clock)).authSessionId;
    });

    clock.advance(31 * 60_000);

    const result = await withRealm(app.db, realmId, async (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: 'x' }, clock),
    );
    expect(result).toMatchObject({ kind: 'failure' });
  });
});

describe('[ODUDU-AUTHN-SESSION-FIXATION-01] session fixation', () => {
  it('issues a session id that differs from the pre-authentication one', async () => {
    const realmId = newId();

    const { authSessionId, subjectId } = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      const { authSessionId: id } = await startAuthentication(tx, realmId, request);
      return { authSessionId: id, subjectId: subject.id };
    });

    const { sessionId } = await withRealm(app.db, realmId, async (tx) =>
      establishSession(tx, realmId, subjectId),
    );

    expect(sessionId).not.toEqual(authSessionId);
  });

  it('issues a different session id on every establishment', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return subject.id;
    });

    const first = await withRealm(app.db, realmId, async (tx) =>
      establishSession(tx, realmId, subjectId),
    );
    const second = await withRealm(app.db, realmId, async (tx) =>
      establishSession(tx, realmId, subjectId),
    );

    expect(first.sessionId).not.toEqual(second.sessionId);
  });
});

describe('[ODUDU-AUTHN-NO-USER-ENUMERATION-01] the password step does not enumerate users', () => {
  it('fails identically for an unknown user and a wrong password', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealmAndUser(tx, realmId, 'ada', 'correct-horse-battery-staple');
    });

    async function sessionFor(): Promise<string> {
      return withRealm(
        app.db,
        realmId,
        async (tx) => (await startAuthentication(tx, realmId, request)).authSessionId,
      );
    }

    const unknownSessionId = await sessionFor();
    const unknown = await withRealm(app.db, realmId, async (tx) =>
      advance(tx, unknownSessionId, { username: 'nobody', password: 'x' }),
    );

    const wrongSessionId = await sessionFor();
    const wrong = await withRealm(app.db, realmId, async (tx) =>
      advance(tx, wrongSessionId, { username: 'ada', password: 'x' }),
    );

    expect(unknown).toEqual(wrong);

    // Sanity: the correct password against the same account does succeed,
    // so the identical failure above is a real non-enumeration property and
    // not a step that always fails.
    const goodSessionId = await sessionFor();
    const good = await withRealm(app.db, realmId, async (tx) =>
      advance(tx, goodSessionId, { username: 'ada', password: 'correct-horse-battery-staple' }),
    );
    expect(good.kind).toBe('success');
  });
});
