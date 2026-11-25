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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  budgetRepository,
  LEVEL_NAMES,
  type LevelLimit,
  type LevelName,
} from '#/repository/budgets';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

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

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const WINDOW = new Date(NOW.getTime() - 3_600_000);
const BIG = 1_000_000;

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `budget-${tenantId.slice(-12)}` });
}

function levels(limits: Partial<Record<LevelName, number>> = {}, window = WINDOW): LevelLimit[] {
  return LEVEL_NAMES.map((level) => ({
    level,
    scopeKey: `${level}-key`,
    slot: level === 'tenant_month' ? null : 'standard',
    limitTokens: limits[level] ?? BIG,
    windowStart: window,
  }));
}

async function usedBy(tx: TenantScopedDatabase): Promise<Record<string, number>> {
  const rows = await tx.execute<{ scope_kind: string; used: string }>(
    sql`select scope_kind, used::text as used from assistant_budget_counters`,
  );
  return Object.fromEntries(rows.map((row) => [row.scope_kind, Number(row.used)]));
}

async function inFreshTenant<T>(fn: (tx: TenantScopedDatabase) => Promise<T>): Promise<T> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    return fn(tx);
  });
}

describe('reserve under contention', () => {
  it.each(LEVEL_NAMES)(
    'admits exactly the ten that fit at the %s level',
    async (tight) => {
      const tenantId = newId();
      await withTenant(app.db, tenantId, async (tx) => seedTenant(tx, tenantId));
      const limits = levels({ [tight]: 100 });

      const results = await Promise.all(
        Array.from({ length: 50 }, async () =>
          withTenant(app.db, tenantId, async (tx) =>
            budgetRepository(tx).reserve({
              turnId: newId(),
              slot: 'standard',
              tokens: 10,
              levels: limits,
              now: NOW,
            }),
          ),
        ),
      );

      const admitted = results.filter((result) => result.ok);
      const refused = results.filter((result) => !result.ok);
      expect(admitted).toHaveLength(10);
      expect(refused).toHaveLength(40);
      expect(refused.map((result) => result.level)).toEqual(
        Array.from({ length: 40 }, () => tight),
      );
      const used = await withTenant(app.db, tenantId, usedBy);
      expect(used).toEqual({
        tenant_month: 100,
        admin_day: 100,
        conversation: 100,
        turn: 100,
      });
    },
    60_000,
  );

  it('names the tightest level that refuses, leaving the others unspent', async () => {
    const used = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const refusal = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 50,
        levels: levels({ conversation: 49 }),
        now: NOW,
      });
      expect(refusal).toEqual({ ok: false, level: 'conversation' });
      return usedBy(tx);
    });

    expect(Object.values(used).every((value) => value === 0)).toBe(true);
  });

  it('starts a counter over when its window has moved on', async () => {
    const result = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const first = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 90,
        levels: levels({ admin_day: 100 }),
        now: NOW,
      });
      const sameWindow = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 90,
        levels: levels({ admin_day: 100 }),
        now: NOW,
      });
      const later = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 90,
        levels: levels({ admin_day: 100 }, new Date(WINDOW.getTime() + 86_400_000)),
        now: NOW,
      });
      return { first: first.ok, sameWindow, later: later.ok, used: await usedBy(tx) };
    });

    expect(result.first).toBe(true);
    expect(result.sameWindow).toEqual({ ok: false, level: 'admin_day' });
    expect(result.later).toBe(true);
    expect(result.used.admin_day).toBe(90);
  });

  it('takes a changed limit from the next call', async () => {
    const refusal = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 60,
        levels: levels({ turn: 100 }),
        now: NOW,
      });
      return repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 10,
        levels: levels({ turn: 65 }),
        now: NOW,
      });
    });

    expect(refusal).toEqual({ ok: false, level: 'turn' });
  });

  it('refuses a request with no level, a repeated level or more than four', async () => {
    await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const base = { turnId: newId(), slot: 'standard' as const, tokens: 1, now: NOW };
      const one = levels()[0];
      if (one === undefined) throw new Error('no level');
      await expect(repo.reserve({ ...base, levels: [] })).rejects.toThrow(/level/u);
      await expect(repo.reserve({ ...base, levels: [one, one] })).rejects.toThrow(/level/u);
    });
  });
});

describe('settle', () => {
  it('charges the actual when it exceeds the reservation, and the next reserve refuses', async () => {
    const outcome = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const limits = levels({ tenant_month: 100 });
      const held = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 50,
        levels: limits,
        now: NOW,
      });
      if (!held.ok) throw new Error('expected admission');
      await repo.markSent(held.reservationId);
      const settled = await repo.settle(held.reservationId, 150);
      const next = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 1,
        levels: limits,
        now: NOW,
      });
      return { settled, next, used: await usedBy(tx) };
    });

    expect(outcome.settled).toEqual({ overrun: 100 });
    expect(outcome.used.tenant_month).toBe(150);
    expect(outcome.next).toEqual({ ok: false, level: 'tenant_month' });
  });

  it('returns the unused part when the actual is below the reservation', async () => {
    const outcome = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const held = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 80,
        levels: levels(),
        now: NOW,
      });
      if (!held.ok) throw new Error('expected admission');
      return { settled: await repo.settle(held.reservationId, 30), used: await usedBy(tx) };
    });

    expect(outcome.settled).toEqual({ overrun: 0 });
    expect(Object.values(outcome.used)).toEqual([30, 30, 30, 30]);
  });

  it('settles a reservation once; a second call changes nothing', async () => {
    const used = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const held = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 40,
        levels: levels(),
        now: NOW,
      });
      if (!held.ok) throw new Error('expected admission');
      await repo.settle(held.reservationId, 10);
      expect(await repo.settle(held.reservationId, 500)).toEqual({ overrun: 0 });
      expect(await repo.markSent(held.reservationId)).toBe(false);
      return usedBy(tx);
    });

    expect(used.tenant_month).toBe(10);
  });

  it('leaves a counter alone once its window has moved on', async () => {
    const used = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const held = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 40,
        levels: levels(),
        now: NOW,
      });
      if (!held.ok) throw new Error('expected admission');
      await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 5,
        levels: levels({}, new Date(WINDOW.getTime() + 86_400_000)),
        now: NOW,
      });
      await repo.settle(held.reservationId, 1_000);
      return usedBy(tx);
    });

    expect(used.tenant_month).toBe(5);
  });
});

describe('sweep', () => {
  it('releases an unsent reservation and charges a sent one in full', async () => {
    const outcome = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      const unsent = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 30,
        levels: levels(),
        now: NOW,
      });
      const sent = await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 70,
        levels: levels(),
        now: NOW,
      });
      if (!unsent.ok || !sent.ok) throw new Error('expected admission');
      await repo.markSent(sent.reservationId);

      const later = new Date(NOW.getTime() + 600_000);
      const swept = await repo.sweep(later, 300_000);
      const again = await repo.sweep(later, 300_000);
      return {
        swept,
        again,
        used: await usedBy(tx),
        settle: await repo.settle(sent.reservationId, 5),
      };
    });

    expect(outcome.swept).toEqual({ released: 1, charged: 1 });
    expect(outcome.again).toEqual({ released: 0, charged: 0 });
    expect(outcome.used.tenant_month).toBe(70);
    expect(outcome.settle).toEqual({ overrun: 0 });
  });

  it('leaves a reservation younger than the age alone', async () => {
    const swept = await inFreshTenant(async (tx) => {
      const repo = budgetRepository(tx);
      await repo.reserve({
        turnId: newId(),
        slot: 'standard',
        tokens: 30,
        levels: levels(),
        now: NOW,
      });
      return repo.sweep(new Date(NOW.getTime() + 60_000), 300_000);
    });

    expect(swept).toEqual({ released: 0, charged: 0 });
  });
});

interface Seeded {
  tenantId: string;
  reservationId: string;
}

async function seedReservation(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  await seedTenant(tx, tenantId);
  const held = await budgetRepository(tx).reserve({
    turnId: newId(),
    slot: 'standard',
    tokens: 10,
    levels: levels(),
    now: NOW,
  });
  if (!held.ok) throw new Error('expected admission');
  return { tenantId, reservationId: held.reservationId };
}

async function verifySeeded(tx: TenantScopedDatabase, seeded: Seeded): Promise<void> {
  expect((await usedBy(tx)).tenant_month).toBe(10);
  const rows = await tx.execute(
    sql`select 1 from assistant_reservations where id = ${seeded.reservationId}`,
  );
  expect(rows).toHaveLength(1);
}

async function unaffected(tx: TenantScopedDatabase, seeded: Seeded): Promise<void> {
  expect(await usedBy(tx)).toEqual({
    tenant_month: 10,
    admin_day: 10,
    conversation: 10,
    turn: 10,
  });
  const rows = await tx.execute<{ sent: boolean; settled: boolean }>(
    sql`select sent, settled from assistant_reservations where id = ${seeded.reservationId}`,
  );
  expect(rows[0]).toEqual({ sent: false, settled: false });
}

describe('every method refuses a foreign tenant', () => {
  it('reserve works only on the caller tenant ledger', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedReservation,
      verifySeeded,
      attempt: async (tx) => {
        const [bound] = await tx.execute<{ tenant: string }>(
          sql`select current_setting('app.tenant_id') as tenant`,
        );
        await seedTenant(tx, bound?.tenant ?? '');
        const result = await budgetRepository(tx).reserve({
          turnId: newId(),
          slot: 'standard',
          tokens: 10,
          levels: levels({ tenant_month: 10 }),
          now: NOW,
        });
        return { result, used: await usedBy(tx) };
      },
      // The same limit admitted tenant A's spend; tenant B starts from zero.
      expectBlocked: (outcome) => {
        expect(outcome).toMatchObject({ result: { ok: true }, used: { tenant_month: 10 } });
      },
      verifyTenantAUnaffected: unaffected,
    });
  });

  it('markSent', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedReservation,
      verifySeeded,
      attempt: async (tx, seeded) => budgetRepository(tx).markSent(seeded.reservationId),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: unaffected,
    });
  });

  it('settle', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedReservation,
      verifySeeded,
      attempt: async (tx, seeded) => budgetRepository(tx).settle(seeded.reservationId, 9_999),
      expectBlocked: (result) => {
        expect(result).toEqual({ overrun: 0 });
      },
      verifyTenantAUnaffected: unaffected,
    });
  });

  it('sweep', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedReservation,
      verifySeeded,
      attempt: async (tx) => budgetRepository(tx).sweep(new Date(NOW.getTime() + 3_600_000), 1),
      expectBlocked: (result) => {
        expect(result).toEqual({ released: 0, charged: 0 });
      },
      verifyTenantAUnaffected: unaffected,
    });
  });
});
