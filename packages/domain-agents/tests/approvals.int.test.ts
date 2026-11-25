import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentApprovalRepository, type NewAgentApproval } from '#/repository/approvals';
import { IN_AN_HOUR, refusalOf, NOW, seedOwner, type Seeded } from '#/testing/seed';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

const DIGEST = 'a'.repeat(64);

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

function input(seeded: Seeded, overrides: Partial<NewAgentApproval> = {}): NewAgentApproval {
  return {
    id: newId(),
    tenantId: seeded.tenantId,
    subjectId: seeded.ownerId,
    requestingClientId: seeded.clientId,
    instanceId: null,
    kind: 'tool_call',
    summary: 'Delete a client',
    actionDigest: DIGEST,
    expiresAt: IN_AN_HOUR,
    ...overrides,
  };
}

async function inTenant<T>(
  fn: (repo: ReturnType<typeof agentApprovalRepository>, seeded: Seeded) => Promise<T>,
): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    const seeded = await seedOwner(tx, tenantId);
    return fn(agentApprovalRepository(tx), seeded);
  });
}

describe('agentApprovalRepository', () => {
  it('creates a pending approval and reads it back', async () => {
    await inTenant(async (repo, seeded) => {
      const record = await repo.create(input(seeded));
      expect(record).toMatchObject({
        state: 'pending',
        decidedAt: null,
        decidedVia: null,
        actionDigest: DIGEST,
        instanceId: null,
      });
      expect(await repo.byId(record.id)).toEqual(record);
      expect(await repo.pendingCount(seeded.ownerId, NOW)).toBe(1);
    });
  });

  it('decide records the decision once and refuses a second', async () => {
    await inTenant(async (repo, seeded) => {
      const record = await repo.create(input(seeded));
      expect(await repo.decide(record.id, 'approved', 'console', NOW)).toBe(true);
      expect(await repo.decide(record.id, 'denied', 'ciba_page', NOW)).toBe(false);
      expect(await repo.byId(record.id)).toMatchObject({
        state: 'approved',
        decidedVia: 'console',
        decidedAt: NOW,
      });
      expect(await repo.pendingCount(seeded.ownerId, NOW)).toBe(0);
    });
  });

  it('decide refuses an expired approval', async () => {
    await inTenant(async (repo, seeded) => {
      const record = await repo.create(input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }));
      expect(await repo.decide(record.id, 'approved', 'console', NOW)).toBe(false);
    });
  });

  it('two concurrent decisions, one approving and one denying, yield exactly one true', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, async (tx) => {
      const s = await seedOwner(tx, tenantId);
      return { s, record: await agentApprovalRepository(tx).create(input(s)) };
    });
    const results = await Promise.all([
      withTenant(app.db, tenantId, async (tx) =>
        agentApprovalRepository(tx).decide(seeded.record.id, 'approved', 'console', NOW),
      ),
      withTenant(app.db, tenantId, async (tx) =>
        agentApprovalRepository(tx).decide(seeded.record.id, 'denied', 'ciba_page', NOW),
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('consume spends an approved approval once, for the same digest only', async () => {
    await inTenant(async (repo, seeded) => {
      const record = await repo.create(input(seeded));
      expect(await repo.consume(record.id, DIGEST, NOW)).toBe(false);
      await repo.decide(record.id, 'approved', 'console', NOW);
      expect(await repo.consume(record.id, 'b'.repeat(64), NOW)).toBe(false);
      expect(await repo.consume(record.id, DIGEST, NOW)).toBe(true);
      expect(await repo.consume(record.id, DIGEST, NOW)).toBe(false);
      expect((await repo.byId(record.id))?.state).toBe('consumed');
    });
  });

  it('consume refuses a denied and an expired approval', async () => {
    await inTenant(async (repo, seeded) => {
      const denied = await repo.create(input(seeded));
      await repo.decide(denied.id, 'denied', 'console', NOW);
      expect(await repo.consume(denied.id, DIGEST, NOW)).toBe(false);

      const late = await repo.create(input(seeded, { expiresAt: new Date(NOW.getTime() + 10) }));
      await repo.decide(late.id, 'approved', 'console', NOW);
      expect(await repo.consume(late.id, DIGEST, new Date(NOW.getTime() + 20))).toBe(false);
    });
  });

  it('expireDue expires only the pending approvals that are due', async () => {
    await inTenant(async (repo, seeded) => {
      const due = await repo.create(input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }));
      const later = await repo.create(input(seeded));
      const approved = await repo.create(input(seeded, { expiresAt: new Date(NOW.getTime() + 5) }));
      await repo.decide(approved.id, 'approved', 'console', NOW);
      expect(await repo.expireDue(new Date(NOW.getTime() + 10))).toBe(1);
      expect((await repo.byId(due.id))?.state).toBe('expired');
      expect((await repo.byId(later.id))?.state).toBe('pending');
      expect((await repo.byId(approved.id))?.state).toBe('approved');
    });
  });
});

describe('agentApprovalRepository page', () => {
  it('lists newest first, a page at a time, before the id it is given', async () => {
    await inTenant(async (repo, seeded) => {
      const made = [];
      for (let i = 0; i < 5; i += 1) made.push(await repo.create(input(seeded)));
      const ids = made
        .map((record) => record.id)
        .sort()
        .reverse();
      const first = await repo.page({ limit: 3 });
      expect(first.map((row) => row.id)).toEqual(ids.slice(0, 3));
      const second = await repo.page({ beforeId: ids[2] ?? '', limit: 3 });
      expect(second.map((row) => row.id)).toEqual(ids.slice(3));
    });
  });

  it('filters by the state the row is in', async () => {
    await inTenant(async (repo, seeded) => {
      const pending = await repo.create(input(seeded));
      const approved = await repo.create(input(seeded));
      const denied = await repo.create(input(seeded));
      await repo.decide(approved.id, 'approved', 'console', NOW);
      await repo.decide(denied.id, 'denied', 'ciba_page', NOW);
      const ids = async (state: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed') =>
        (await repo.page({ state, limit: 10 })).map((row) => row.id);
      expect(await ids('pending')).toEqual([pending.id]);
      expect(await ids('approved')).toEqual([approved.id]);
      expect(await ids('denied')).toEqual([denied.id]);
      expect(await ids('expired')).toEqual([]);
      expect(await ids('consumed')).toEqual([]);
    });
  });
});

describe('agentApprovalRepository across tenants', () => {
  const seedApproval = async (
    tx: TenantScopedDatabase,
    tenantId: string,
  ): Promise<{ id: string; subjectId: string }> => {
    const seeded = await seedOwner(tx, tenantId);
    const record = await agentApprovalRepository(tx).create(input(seeded));
    await agentApprovalRepository(tx).decide(record.id, 'approved', 'console', NOW);
    await agentApprovalRepository(tx).create(
      input(seeded, { expiresAt: new Date(NOW.getTime() - 1) }),
    );
    return { id: record.id, subjectId: seeded.ownerId };
  };

  const stillApproved = async (tx: TenantScopedDatabase, s: { id: string }): Promise<void> => {
    expect((await agentApprovalRepository(tx).byId(s.id))?.state).toBe('approved');
  };

  it('byId finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedApproval,
      verifySeeded: stillApproved,
      attempt: async (tx, s) => agentApprovalRepository(tx).byId(s.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('decide and consume change nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedApproval,
      verifySeeded: stillApproved,
      attempt: async (tx, s) => {
        const repo = agentApprovalRepository(tx);
        return [
          await repo.decide(s.id, 'denied', 'console', NOW),
          await repo.consume(s.id, DIGEST, NOW),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([false, false]);
      },
      verifyTenantAUnaffected: stillApproved,
    });
  });

  it('page lists none, with a state or without', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedApproval,
      verifySeeded: async (tx) => {
        expect(await agentApprovalRepository(tx).page({ limit: 10 })).toHaveLength(2);
      },
      attempt: async (tx) => {
        const repo = agentApprovalRepository(tx);
        return [
          await repo.page({ limit: 10 }),
          await repo.page({ state: 'approved', limit: 10 }),
          await repo.page({ state: 'pending', limit: 10 }),
        ];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([[], [], []]);
      },
    });
  });

  it('pendingCount sees none and expireDue expires none', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedApproval,
      verifySeeded: stillApproved,
      attempt: async (tx, s) => {
        const repo = agentApprovalRepository(tx);
        return [await repo.pendingCount(s.subjectId, NOW), await repo.expireDue(IN_AN_HOUR)];
      },
      expectBlocked: (result) => {
        expect(result).toEqual([0, 0]);
      },
      verifyTenantAUnaffected: stillApproved,
    });
  });

  it('create refuses a subject of another tenant', async () => {
    const tenantId = newId();
    const foreign = await withTenant(app.db, tenantId, async (tx) => seedOwner(tx, tenantId));
    expect(
      await refusalOf(
        withTenant(app.db, newId(), async (tx) =>
          agentApprovalRepository(tx).create(input(foreign)),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
