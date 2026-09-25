import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { executionRepository } from '#/repository/executions';
import {
  advance,
  initialChallenge,
  registeredAuthenticatorNames,
  startAuthentication,
} from '#/usecase/executor';
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

async function seedTenantAndUser(
  tx: TenantScopedDatabase,
  tenantId: string,
  username: string,
  password: string,
): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionBrowserFlow(tx, tenantId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
  await tx.insert(userCredentials).values({
    id: newId(),
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(password) },
  });
  return subject.id;
}

describe('[ODUDU-AUTHN-FLOW-ORDER-01] a tenant dispatches its own ordered executions', () => {
  it('offers password, not passkey, as the first applicable execution', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionBrowserFlow(tx, tenantId);
    });

    // BROWSER_FLOW_DEFAULT lists passkey before password in the same
    // alternative group; getting password back rather than passkey is what
    // proves passkey inapplicable, not merely unpicked.
    const challenge = await withTenant(app.db, tenantId, (tx) => initialChallenge(tx, tenantId));
    expect(challenge).toEqual({ kind: 'challenge', form: 'password' });
  });

  it('completes after a correct password rather than challenging otp', async () => {
    const tenantId = newId();
    const password = 'correct-horse-battery-staple';
    const subjectId = await withTenant(app.db, tenantId, (tx) =>
      seedTenantAndUser(tx, tenantId, 'ada', password),
    );

    const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, tenantId, request);
      return id;
    });

    // otp is a conditional execution in BROWSER_FLOW_DEFAULT; getting
    // 'success' rather than a second challenge is what proves it
    // inapplicable for this subject, since a conditional applicable
    // execution would be offered next instead.
    const result = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(result).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
  });

  it('persists nothing for a factor that finishes the login, so a retry re-runs it', async () => {
    const tenantId = newId();
    const password = 'correct-horse-battery-staple';
    const subjectId = await withTenant(app.db, tenantId, (tx) =>
      seedTenantAndUser(tx, tenantId, 'ada', password),
    );

    const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
      const { authSessionId: id } = await startAuthentication(tx, tenantId, request);
      return id;
    });

    const first = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(first).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });

    // Nothing was written: password was the login's last factor, and a
    // retry (an id_token_hint mismatch, an unverified email — both leave
    // the session unconsumed downstream of this function) has to re-run it
    // exactly as the first attempt did, not find it already satisfied.
    const record = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.satisfied).toEqual([]);

    const second = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password }),
    );
    expect(second).toEqual({ kind: 'success', subjectId, authenticators: ['password'] });
  });
});

describe('[ODUDU-AUTHN-SATISFIED-PERSISTENCE-01] satisfied executions round-trip and stay tenant-scoped', () => {
  it('records an authenticator as satisfied and reads it back', async () => {
    const tenantId = newId();
    const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      const { authSessionId: id } = await startAuthentication(tx, tenantId, request);
      return id;
    });

    const before = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(before?.satisfied).toEqual([]);

    await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).recordSatisfied(authSessionId, 'password'),
    );

    const after = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(after?.satisfied).toEqual(['password']);
  });

  it('cannot record satisfied progress under a different tenant context, and leaves it unaffected', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        const { authSessionId } = await startAuthentication(tx, tenantId, request);
        return authSessionId;
      },
      verifySeeded: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.satisfied).toEqual([]);
      },
      attempt: async (tx, authSessionId) =>
        authenticationSessionRepository(tx).recordSatisfied(authSessionId, 'password'),
      expectBlocked: () => {
        // An UPDATE affecting zero rows under a foreign tenant context, not
        // a thrown error or a returned value — verifyTenantAUnaffected is
        // where the blocking actually shows.
      },
      verifyTenantAUnaffected: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.satisfied).toEqual([]);
      },
    });
  });
});

describe('[ODUDU-AUTHN-SESSION-EXPIRY-UNCHANGED-01] expiry is checked before the registry runs', () => {
  it('still refuses an expired authentication session', async () => {
    const tenantId = newId();
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));

    const authSessionId = await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionBrowserFlow(tx, tenantId);
      return (await startAuthentication(tx, tenantId, request, clock)).authSessionId;
    });

    clock.advance(31 * 60_000);

    const result = await withTenant(app.db, tenantId, (tx) =>
      advance(tx, authSessionId, { username: 'ada', password: 'x' }, clock),
    );
    expect(result).toEqual({ kind: 'failure', reason: 'authentication_session_expired' });
  });
});

// `startsALogin` (#/service/flow-start.ts) refuses a tenant flow that would
// render nothing at login start, and it decides that by mirroring one fact
// this file's `isApplicable` owns: with no subject bound and nothing
// submitted, `password` is the only authenticator that applies. The layer
// rule keeps that copy from calling this one, so the invariant is pinned
// here instead — where a change to `isApplicable` is made.
describe('[ODUDU-AUTHN-FLOW-ORDER-01] at login start, password is the only applicable step', () => {
  it.each(registeredAuthenticatorNames())(
    'a flow of %s alone renders only when it is password',
    async (authenticator) => {
      const tenantId = newId();
      await withTenant(app.db, tenantId, async (tx) => {
        await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
        await executionRepository(tx).replaceForTenant(tenantId, [
          { authenticator, requirement: 'required' },
        ]);
      });

      const challenge = await withTenant(app.db, tenantId, (tx) => initialChallenge(tx, tenantId));
      expect(challenge.kind, authenticator).toBe(
        authenticator === 'password' ? 'challenge' : 'failure',
      );
    },
  );
});
