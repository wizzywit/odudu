import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { budgetRepository, type LevelLimit, type LevelName } from '#/repository/budgets';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 6 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const OLD = new Date(NOW.getTime() - 3_600_000);
const WINDOW = new Date(NOW.getTime() - 7_200_000);
const NEXT_WINDOW = new Date(WINDOW.getTime() + 86_400_000);
const BIG = 1_000_000;
const AGE = 300_000;

function lv(level: LevelName, key: string, window = WINDOW, limitTokens = BIG): LevelLimit {
  return { level, scopeKey: key, slot: null, limitTokens, windowStart: window };
}

async function seedTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `lock-${tenantId.slice(-12)}` });
  });
  return tenantId;
}

async function reserveOk(
  tx: TenantScopedDatabase,
  levels: LevelLimit[],
  tokens: number,
  now = NOW,
): Promise<string> {
  const held = await budgetRepository(tx).reserve({
    turnId: newId(),
    slot: 'standard',
    tokens,
    levels,
    now,
  });
  if (!held.ok) throw new Error('expected admission');
  return held.reservationId;
}

async function usedOf(tx: TenantScopedDatabase, kind: LevelName, key: string): Promise<number> {
  const rows = await tx.execute<{ used: string }>(
    sql`select used::text as used from assistant_budget_counters
         where scope_kind = ${kind} and scope_key = ${key}`,
  );
  return Number(rows[0]?.used);
}

const pause = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('lock order across statements', () => {
  it('a sweep never deadlocks with a reserve that holds a later counter first', async () => {
    const tenantId = await seedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      await reserveOk(tx, [lv('admin_day', 'd1'), lv('conversation', 'c1')], 10, OLD);
      await reserveOk(
        tx,
        [lv('tenant_month', 'm'), lv('admin_day', 'd1')],
        10,
        new Date(OLD.getTime() + 1000),
      );
    });

    const holder = withTenant(app.db, tenantId, async (tx) => {
      await reserveOk(tx, [lv('tenant_month', 'm')], 1);
      await pause(800);
      await reserveOk(tx, [lv('admin_day', 'd1')], 1);
    });
    const sweeper = withTenant(app.db, tenantId, async (tx) => {
      await pause(200);
      return budgetRepository(tx).sweep(NOW, AGE);
    });
    const outcomes = await Promise.allSettled([holder, sweeper]);

    expect(outcomes.map((entry) => entry.status)).toEqual(['fulfilled', 'fulfilled']);
  }, 30_000);

  it('concurrent reserves and sweeps abort no one and lose no token, repeated', async () => {
    const tenantId = await seedTenant();
    const first = [lv('admin_day', 'd1'), lv('conversation', 'c1')];
    const second = [lv('tenant_month', 'm'), lv('admin_day', 'd1')];
    for (let round = 0; round < 8; round += 1) {
      await withTenant(app.db, tenantId, async (tx) => {
        await reserveOk(tx, first, 10, OLD);
        await reserveOk(tx, second, 10, new Date(OLD.getTime() + 1000));
      });
      const outcomes = await Promise.allSettled([
        withTenant(app.db, tenantId, async (tx) => reserveOk(tx, first, 1)),
        withTenant(app.db, tenantId, async (tx) => reserveOk(tx, second, 1)),
        withTenant(app.db, tenantId, async (tx) => budgetRepository(tx).sweep(NOW, AGE)),
      ]);
      expect(outcomes.map((entry) => entry.status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ]);
    }
    const used = await withTenant(app.db, tenantId, async (tx) => ({
      d1: await usedOf(tx, 'admin_day', 'd1'),
      c1: await usedOf(tx, 'conversation', 'c1'),
      m: await usedOf(tx, 'tenant_month', 'm'),
    }));

    expect(used).toEqual({ d1: 16, c1: 8, m: 8 });
  }, 60_000);
});

describe('a stale window', () => {
  it('is refunded by settle and by sweep, not left charged', async () => {
    const tenantId = await seedTenant();
    const outcome = await withTenant(app.db, tenantId, async (tx) => {
      const repo = budgetRepository(tx);
      await reserveOk(tx, [lv('admin_day', 'k', NEXT_WINDOW)], 10);
      const viaSettle = await reserveOk(tx, [lv('admin_day', 'k', WINDOW)], 20);
      const afterReserve = await usedOf(tx, 'admin_day', 'k');
      await repo.settle(viaSettle, 0);
      const afterSettle = await usedOf(tx, 'admin_day', 'k');
      await reserveOk(tx, [lv('admin_day', 'k', WINDOW)], 20, OLD);
      await repo.sweep(NOW, AGE);
      return { afterReserve, afterSettle, afterSweep: await usedOf(tx, 'admin_day', 'k') };
    });

    expect(outcome).toEqual({ afterReserve: 30, afterSettle: 10, afterSweep: 10 });
  });
});

describe('concurrent window roll and settle', () => {
  it('admits exactly what fits the new window when many reserves roll it at once', async () => {
    const tenantId = await seedTenant();
    await withTenant(app.db, tenantId, async (tx) => {
      await reserveOk(tx, [lv('admin_day', 'r', WINDOW, 100)], 90);
    });

    const results = await Promise.all(
      Array.from({ length: 30 }, async () =>
        withTenant(app.db, tenantId, async (tx) =>
          budgetRepository(tx).reserve({
            turnId: newId(),
            slot: 'standard',
            tokens: 10,
            levels: [lv('admin_day', 'r', NEXT_WINDOW, 100)],
            now: NOW,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(10);
    expect(await withTenant(app.db, tenantId, async (tx) => usedOf(tx, 'admin_day', 'r'))).toBe(
      100,
    );
  }, 60_000);

  it('keeps the ledger exact when a settle races reserves', async () => {
    const tenantId = await seedTenant();
    const held = await withTenant(app.db, tenantId, async (tx) =>
      reserveOk(tx, [lv('admin_day', 's', WINDOW, 100)], 50),
    );

    const settled = withTenant(app.db, tenantId, async (tx) =>
      budgetRepository(tx).settle(held, 20),
    );
    const reserves = Array.from({ length: 12 }, async () =>
      withTenant(app.db, tenantId, async (tx) =>
        budgetRepository(tx).reserve({
          turnId: newId(),
          slot: 'standard',
          tokens: 10,
          levels: [lv('admin_day', 's', WINDOW, 100)],
          now: NOW,
        }),
      ),
    );
    await settled;
    const admitted = (await Promise.all(reserves)).filter((result) => result.ok).length;

    const used = await withTenant(app.db, tenantId, async (tx) => usedOf(tx, 'admin_day', 's'));
    expect(used).toBe(20 + 10 * admitted);
    expect(admitted).toBeGreaterThanOrEqual(5);
    expect(admitted).toBeLessThanOrEqual(8);
  }, 60_000);
});

describe('sweep bounds', () => {
  const LATER = new Date(NOW.getTime() + 600_000);

  it('resolves at most 200 reservations per call', async () => {
    const tenantId = await seedTenant();
    const counts = await withTenant(app.db, tenantId, async (tx) => {
      for (let n = 0; n < 205; n += 1) await reserveOk(tx, [lv('turn', 'b')], 1);
      const repo = budgetRepository(tx);
      return { first: await repo.sweep(LATER, AGE), second: await repo.sweep(LATER, AGE) };
    });

    expect(counts.first).toEqual({ released: 200, charged: 0 });
    expect(counts.second).toEqual({ released: 5, charged: 0 });
  }, 60_000);

  it('skips a reservation another transaction holds instead of waiting for it', async () => {
    const tenantId = await seedTenant();
    const ids = await withTenant(app.db, tenantId, async (tx) => [
      await reserveOk(tx, [lv('turn', 'one')], 1),
      await reserveOk(tx, [lv('turn', 'two')], 1),
    ]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = withTenant(app.db, tenantId, async (tx) => {
      await budgetRepository(tx).settle(ids[0] ?? '', 1);
      locked();
      await gate;
    });
    await holding;

    const swept = await withTenant(app.db, tenantId, async (tx) =>
      budgetRepository(tx).sweep(LATER, AGE),
    );
    release();
    await holder;

    expect(swept).toEqual({ released: 1, charged: 0 });
  }, 30_000);
});
