import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { sessionRepository } from '#/repository/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const PENDING_REQUEST: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

describe('sessionRepository', () => {
  it('cannot find a session by id under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        const id = newId();
        await sessionRepository(tx).create({
          id,
          realmId,
          subjectId: subject.id,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, id) => sessionRepository(tx).byId(id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});

describe('authenticationSessionRepository', () => {
  // `byId` is read twice per login attempt by the flow executor: once to
  // load the parked request and once after `consume` succeeds. `consume`
  // being realm-scoped says nothing about the read that precedes it, which
  // is where the parked request — client_id, redirect_uri, scope, nonce —
  // would leak across realms.
  it('cannot find an authentication session by id under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          realmId,
          pendingRequest: PENDING_REQUEST,
          expiresAt: new Date(Date.now() + 600_000),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.pendingRequest.clientId).toBe(PENDING_REQUEST.clientId);
      },
      attempt: async (tx, id) => authenticationSessionRepository(tx).byId(id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot consume an authentication session under a different realm context, and leaves it unconsumed', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          realmId,
          pendingRequest: PENDING_REQUEST,
          expiresAt: new Date(Date.now() + 600_000),
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.consumedAt).toBeNull();
      },
      attempt: async (tx, id) => authenticationSessionRepository(tx).consume(id, new Date()),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.consumedAt).toBeNull();
      },
    });
  });
});
