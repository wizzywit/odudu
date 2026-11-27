import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetRepository, pruneStatements } from '#/repository/budgets';
import { leaseRepository, pruneLeasesStatement } from '#/repository/leases';
import { levelLimitsFor, type AssistantLimits } from '#/service/limits';
import { MAX_OUTPUT_TOKENS } from '#/service/request-size';
import { createTurnBudget } from '#/usecase/budget-hooks';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 10 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const DAY = 86_400_000;

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `upkeep-${tenantId.slice(-12)}` });
}

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => seedTenant(tx, tenantId));
  return tenantId;
}

describe('leaseRepository', () => {
  const lease = (max: number, at = NOW) => ({
    turnId: newId(),
    conversationId: newId(),
    max,
    now: at,
    ttlMs: 60_000,
  });

  it('admits exactly the tenant maximum among concurrent acquirers on separate connections', async () => {
    const tenantId = await freshTenant();
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        withTenant(app.db, tenantId, async (tx) => leaseRepository(tx).acquire(lease(3))),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => !result.ok)).toHaveLength(27);
  }, 60_000);

  it('gives a place back on release, and lets one lapse at its expiry', async () => {
    const tenantId = await freshTenant();
    const outcome = await withTenant(app.db, tenantId, async (tx) => {
      const repo = leaseRepository(tx);
      const first = lease(1);
      expect((await repo.acquire(first)).ok).toBe(true);
      const full = await repo.acquire(lease(1));
      await repo.release(first.turnId);
      const afterRelease = await repo.acquire(lease(1));
      const later = new Date(NOW.getTime() + 61_000);
      const afterExpiry = await repo.acquire(lease(1, later));
      return { full, afterRelease, afterExpiry };
    });
    expect(outcome.full).toEqual({ ok: false, live: 1 });
    expect(outcome.afterRelease.ok).toBe(true);
    expect(outcome.afterExpiry.ok).toBe(true);
  });

  it('counts a tenant on its own, not by another tenant’s leases', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    await withTenant(app.db, a, async (tx) => leaseRepository(tx).acquire(lease(1)));
    const other = await withTenant(app.db, b, async (tx) => leaseRepository(tx).acquire(lease(1)));
    expect(other.ok).toBe(true);
  });

  it('does not release or prune another tenant’s lease', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const input = lease(5, new Date(NOW.getTime() - 10 * DAY));
        await leaseRepository(tx).acquire(input);
        return input.turnId;
      },
      verifySeeded: async (tx, turnId) => {
        const rows = await tx.execute(
          sql`select 1 from assistant_turn_leases where turn_id = ${turnId}`,
        );
        expect(rows).toHaveLength(1);
      },
      attempt: async (tx, turnId) => {
        const repo = leaseRepository(tx);
        await repo.release(turnId);
        return repo.prune(NOW, 100);
      },
      expectBlocked: (pruned) => {
        expect(pruned).toBe(0);
      },
      verifyTenantAUnaffected: async (tx, turnId) => {
        const rows = await tx.execute(
          sql`select 1 from assistant_turn_leases where turn_id = ${turnId}`,
        );
        expect(rows).toHaveLength(1);
      },
    });
  });

  it('deletes expired leases only, at most one batch', async () => {
    const tenantId = await freshTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      const repo = leaseRepository(tx);
      const old = new Date(NOW.getTime() - 3 * DAY);
      for (let n = 0; n < 5; n += 1) await repo.acquire(lease(50, old));
      await repo.acquire(lease(50));
      expect(await repo.prune(new Date(NOW.getTime() - DAY), 3)).toBe(3);
      expect(await repo.prune(new Date(NOW.getTime() - DAY), 3)).toBe(2);
      expect(await repo.prune(new Date(NOW.getTime() - DAY), 3)).toBe(0);
    });
  });
});

describe('budgetRepository.usage and prune', () => {
  const limits: AssistantLimits = {
    monthlyTokensBySlot: { fast: 1000, standard: 1000, deep: 1000 },
    allowedModels: [],
    toolClasses: ['read'],
    modes: ['ask'],
    maxConcurrent: 5,
    maxStepsPerTurn: 20,
  };

  function levels(at: Date, turnId = newId(), key = 'a') {
    return levelLimitsFor({
      tenantId: `t-${key}`,
      ownerSubjectId: `s-${key}`,
      conversationId: `c-${key}`,
      turnId,
      slot: 'standard',
      limits,
      now: at,
      turnStartedAt: at,
    });
  }

  it('reads what each level holds after a reservation', async () => {
    const tenantId = await freshTenant();
    const usage = await withTenant(app.db, tenantId, async (tx) => {
      const repo = budgetRepository(tx);
      const held = levels(NOW);
      await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 200,
        levels: held,
        now: NOW,
      });
      return repo.usage(held);
    });
    expect(usage.map((entry) => [entry.level, entry.used])).toEqual([
      ['tenant_month', 200],
      ['admin_day', 200],
      ['conversation', 200],
      ['turn', 200],
    ]);
    expect(usage[0]?.limit).toBe(1000);
  });

  it('does not read another tenant’s counters', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    const held = levels(NOW);
    await withTenant(app.db, a, async (tx) =>
      budgetRepository(tx).reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 10,
        levels: held,
        now: NOW,
      }),
    );
    expect(await withTenant(app.db, b, async (tx) => budgetRepository(tx).usage(held))).toEqual([]);
  });

  it('prunes spent windows and settled reservations, leaving current ones, a batch at a time', async () => {
    const tenantId = await freshTenant();
    const old = new Date(NOW.getTime() - 100 * DAY);
    const cutoffs = {
      shortWindowsBefore: new Date(NOW.getTime() - 2 * DAY),
      monthlyWindowsBefore: new Date(NOW.getTime() - 62 * DAY),
      settledBefore: new Date(NOW.getTime() - 2 * DAY),
    };
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const repo = budgetRepository(tx);
      const spent = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 5,
        levels: levels(old, newId(), 'old'),
        now: old,
      });
      if (!spent.ok) throw new Error('refused');
      await repo.settle(spent.reservationId, 5);
      const live = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 5,
        levels: levels(NOW),
        now: NOW,
      });
      const first = await repo.prune(cutoffs, 2);
      const rest = await repo.prune(cutoffs, 100);
      const none = await repo.prune(cutoffs, 100);
      const remaining = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from assistant_budget_counters`,
      );
      const reservations = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from assistant_reservations`,
      );
      return { live: live.ok, first, rest, none, remaining, reservations };
    });
    expect(result.live).toBe(true);
    // Four spent counters, two a batch for the short levels and two for the monthly.
    expect(result.first.counters + result.rest.counters).toBe(4);
    expect(result.first.counters).toBeLessThanOrEqual(4);
    expect(result.first.reservations).toBe(1);
    expect(result.none).toEqual({ counters: 0, reservations: 0 });
    expect(result.remaining[0]?.n).toBe(4);
    expect(result.reservations[0]?.n).toBe(1);
  });

  it('serves each upkeep delete from an index with no table scan, at volume', async () => {
    const tenantId = await freshTenant();
    await owner.sql`
      insert into assistant_budget_counters
        (tenant_id, scope_kind, scope_key, slot, used, limit_tokens, window_start)
      select ${tenantId}, (array['turn','admin_day','tenant_month','conversation'])[1 + n % 4],
             'k' || n, null, 1, 100, now() - ((n % 400) || ' days')::interval
        from generate_series(1, 60000) n`;
    await owner.sql`
      insert into assistant_reservations
        (tenant_id, id, turn_id, slot, reserved, levels, sent, settled, created_at)
      select ${tenantId}, gen_random_uuid(), gen_random_uuid(), 'standard', 1,
             '[{"level":"turn"}]'::jsonb, true, n % 10 <> 0, now() - ((n % 400) || ' hours')::interval
        from generate_series(1, 60000) n`;
    await owner.sql`
      insert into assistant_turn_leases (tenant_id, turn_id, conversation_id, created_at, expires_at)
      select ${tenantId}, gen_random_uuid(), gen_random_uuid(), now() - interval '30 days',
             now() - ((n % 400) || ' hours')::interval
        from generate_series(1, 20000) n`;
    await owner.sql`analyze assistant_budget_counters`;
    await owner.sql`analyze assistant_reservations`;
    await owner.sql`analyze assistant_turn_leases`;

    const dialect = new PgDialect();
    const prune = pruneStatements(
      {
        shortWindowsBefore: new Date(NOW.getTime() - 2 * DAY),
        monthlyWindowsBefore: new Date(NOW.getTime() - 62 * DAY),
        settledBefore: new Date(NOW.getTime() - 2 * DAY),
      },
      10_000,
    );
    const statements = [
      [...prune.counters, prune.reservations, pruneLeasesStatement(NOW, 10_000)].map((entry) =>
        dialect.sqlToQuery(entry),
      ),
    ].flat();
    const plans = await app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const out: string[] = [];
      for (const statement of statements) {
        const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
          `EXPLAIN (FORMAT JSON) ${statement.sql}`,
          statement.params as never[],
        );
        out.push(JSON.stringify(rows[0]?.['QUERY PLAN']));
      }
      return out;
    });

    expect(plans).toHaveLength(4);
    expect(plans[0]).toContain('assistant_budget_counters_window');
    expect(plans[1]).toContain('assistant_budget_counters_window');
    expect(plans[2]).toContain('assistant_reservations_settled');
    expect(plans[3]).toContain('assistant_turn_leases_live');
    for (const plan of plans) expect(plan).not.toContain('"Node Type":"Seq Scan"');
  }, 120_000);
});

describe('the floor from the previous step’s reported input', () => {
  const GENEROUS: AssistantLimits = {
    monthlyTokensBySlot: { fast: 50_000_000, standard: 50_000_000, deep: 50_000_000 },
    allowedModels: [],
    toolClasses: ['read'],
    modes: ['ask'],
    maxConcurrent: 5,
    maxStepsPerTurn: 20,
  };

  it('is recorded from the step that reported it, and left alone by a step that reported none', async () => {
    const tenantId = await freshTenant();
    const budget = createTurnBudget({
      transact: (fn) => withTenant(app.db, tenantId, fn),
      now: () => NOW,
      limits: GENEROUS,
      tenantId,
      ownerSubjectId: 's',
      conversationId: 'c',
      turnId: newId(),
      slot: 'standard',
      onWarning: () => undefined,
      onOverrun: () => undefined,
    });
    const request = (bytes: number) => ({ fixed: 'f', messages: 'm'.repeat(bytes) });
    const reservations = async () =>
      (
        await withTenant(app.db, tenantId, (tx) =>
          tx.execute<{ reserved: string }>(
            sql`select reserved::text as reserved from assistant_reservations order by created_at, id`,
          ),
        )
      ).map((row) => Number(row.reserved));
    const [m1, m2, m3, m4] = [1000, 3000, 7000, 12_000];

    await budget.beforeCall(request(m1));
    await budget.afterCall({ inputTokens: 200_000, totalTokens: 10 });
    await budget.beforeCall(request(m2));
    // Zero input reported: the floor stays at the first step's.
    await budget.afterCall({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    await budget.beforeCall(request(m3));
    await budget.afterCall({ inputTokens: 300_000, totalTokens: 10 });
    await budget.beforeCall(request(m4));
    await budget.finish();

    const [first, second, third, fourth] = await reservations();
    expect(first).toBeLessThan(10_000 + MAX_OUTPUT_TOKENS * 2);
    expect(second).toBe(200_000 + (m2 - m1) + MAX_OUTPUT_TOKENS);
    expect(third).toBe(200_000 + (m3 - m1) + MAX_OUTPUT_TOKENS);
    expect(fourth).toBe(300_000 + (m4 - m3) + MAX_OUTPUT_TOKENS);
  });
});
