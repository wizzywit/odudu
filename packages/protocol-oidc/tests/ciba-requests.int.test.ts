import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { agentApprovalRepository } from '@odudu/domain-agents';
import { subjectRepository } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cibaRequestRepository } from '#/repository/ciba-requests';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function seedRequest(
  tx: TenantScopedDatabase,
  tenantId: string,
  overrides: { hint?: string; expiresAt?: Date; subject?: boolean; approval?: boolean } = {},
) {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `client-${clientId}`,
    name: 'An agent',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  const id = newId();
  const hash = newId();
  let subjectId: string | null = null;
  let approvalId: string | null = null;
  if (overrides.approval === true) {
    subjectId = (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
    approvalId = (
      await agentApprovalRepository(tx).create({
        id: newId(),
        tenantId,
        subjectId,
        requestingClientId: clientId,
        instanceId: null,
        kind: 'ciba',
        summary: 'asks',
        actionDigest: 'd',
        expiresAt: new Date(NOW.getTime() + 600_000),
      })
    ).id;
  }
  await cibaRequestRepository(tx).create({
    id,
    tenantId,
    authReqHash: hash,
    clientId,
    subjectId,
    approvalId,
    hintDigest: overrides.hint ?? 'digest',
    scope: 'openid',
    bindingMessage: null,
    requestedExpiry: null,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 600_000),
  });
  return { id, hash, clientId, approvalId };
}

describe('the ciba_requests table', () => {
  it('filters its rows by tenant', async () => {
    await expectTenantIsolation(app.db, {
      table: 'ciba_requests',
      seed: async (tx, tenantId) => {
        await seedRequest(tx, tenantId);
      },
    });
  });

  it('is found by hash only within the tenant that holds it', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedRequest(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect((await cibaRequestRepository(tx).byHash(seeded.hash))?.id).toBe(seeded.id);
      },
      attempt: (tx, seeded) => cibaRequestRepository(tx).byHash(seeded.hash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('is found by approval only within the tenant that holds it', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedRequest(tx, tenantId, { approval: true }),
      verifySeeded: async (tx, seeded) => {
        expect((await cibaRequestRepository(tx).byApprovalId(seeded.approvalId ?? ''))?.id).toBe(
          seeded.id,
        );
      },
      attempt: (tx, seeded) => cibaRequestRepository(tx).byApprovalId(seeded.approvalId ?? ''),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('does not record a poll of another tenant, and leaves the row alone', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedRequest(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect((await cibaRequestRepository(tx).byHash(seeded.hash))?.lastPolledAt).toBeNull();
      },
      attempt: (tx, seeded) => cibaRequestRepository(tx).recordPoll(seeded.id, NOW),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await cibaRequestRepository(tx).byHash(seeded.hash))?.lastPolledAt).toBeNull();
      },
    });
  });

  it('counts the live requests of a client for a hint, in its own tenant only', async () => {
    const tenantId = newId();
    const clientId = await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedRequest(tx, tenantId, { hint: 'a' });
      const repository = cibaRequestRepository(tx);
      expect(await repository.liveCountFor(seeded.clientId, 'a', NOW)).toBe(1);
      expect(await repository.liveCountFor(seeded.clientId, 'b', NOW)).toBe(0);
      expect(await repository.liveCountFor(newId(), 'a', NOW)).toBe(0);
      expect(
        await repository.liveCountFor(seeded.clientId, 'a', new Date(NOW.getTime() + 601_000)),
      ).toBe(0);
      return seeded.clientId;
    });
    await withTenant(app.db, newId(), async (tx) => {
      expect(await cibaRequestRepository(tx).liveCountFor(clientId, 'a', NOW)).toBe(0);
    });
  });

  it('raises the interval by five seconds for a poll before it elapsed, and not otherwise', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedRequest(tx, tenantId);
      const repository = cibaRequestRepository(tx);
      expect(await repository.recordPoll(seeded.id, NOW)).toBe('on_time');
      expect(await repository.recordPoll(seeded.id, new Date(NOW.getTime() + 2000))).toBe('early');
      expect((await repository.byHash(seeded.hash))?.intervalSeconds).toBe(10);
      expect(await repository.recordPoll(seeded.id, new Date(NOW.getTime() + 13_000))).toBe(
        'on_time',
      );
      expect((await repository.byHash(seeded.hash))?.intervalSeconds).toBe(10);
    });
  });
});
