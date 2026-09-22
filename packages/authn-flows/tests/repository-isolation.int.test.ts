import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

describe('sessionRepository', () => {
  it('cannot find a session by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const id = newId();
        await sessionRepository(tx).create({
          id,
          tenantId,
          subjectId: subject.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          authenticators: [],
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

  it('cannot end a session under a different tenant context, and leaves it live', async () => {
    const originalExpiry = new Date(Date.now() + 3_600_000);
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const id = newId();
        await sessionRepository(tx).create({
          id,
          tenantId,
          subjectId: subject.id,
          expiresAt: originalExpiry,
          authenticators: [],
        });
        return id;
      },
      verifySeeded: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found?.expiresAt).toEqual(originalExpiry);
      },
      attempt: async (tx, id) => sessionRepository(tx).end(id, new Date()),
      expectBlocked: () => {
        // `end` is an UPDATE affecting zero rows under a foreign tenant
        // context, not a thrown error or a returned value to assert on —
        // `verifyTenantAUnaffected` is where the blocking actually shows.
      },
      verifyTenantAUnaffected: async (tx, id) => {
        const found = await sessionRepository(tx).byId(id);
        expect(found?.expiresAt).toEqual(originalExpiry);
      },
    });
  });
});

describe('authenticationSessionRepository', () => {
  // `byId` is read twice per login attempt by the flow executor: once to
  // load the parked request and once after `consume` succeeds. `consume`
  // being tenant-scoped says nothing about the read that precedes it, which
  // is where the parked request — client_id, redirect_uri, scope, nonce —
  // would leak across tenants.
  it('cannot find an authentication session by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          tenantId,
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

  it('cannot consume an authentication session under a different tenant context, and leaves it unconsumed', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const id = newId();
        await authenticationSessionRepository(tx).create({
          id,
          tenantId,
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
      verifyTenantAUnaffected: async (tx, id) => {
        const found = await authenticationSessionRepository(tx).byId(id);
        expect(found?.consumedAt).toBeNull();
      },
    });
  });
});
