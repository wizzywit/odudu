import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TenantSettingCheckViolationError,
  tenantSettingsRepository,
} from '#/repository/tenant-settings';
import {
  TENANT_SETTING_COLUMNS,
  TENANT_SETTING_ORDERINGS,
  TENANT_SETTING_RANGES,
  tenantSettingProblems,
  type TenantSettingName,
} from '#/service/tenant-settings';

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

const INT4_MAX = 2_147_483_647;

// A text CHECK the predicate does not restate: `name` is not a setting,
// and `client_registration_policy`'s values are SETTINGS' own enumeration,
// which `coerceTenantSetting` already refuses outside.
const NOT_RANGES = new Set(['name', 'client_registration_policy']);

function columnOf(name: TenantSettingName): string {
  const entry = TENANT_SETTING_COLUMNS.find((column) => column.name === name);
  if (entry === undefined) throw new Error(`no column for ${name}`);
  return entry.column;
}

// Whether the database accepts `change` over a fresh tenant's defaults, and
// whether the predicate does, judged over the same merged record.
async function verdicts(
  change: Partial<Record<TenantSettingName, number>>,
): Promise<{ database: boolean; predicate: boolean }> {
  const id = newId();
  let predicate = false;
  try {
    await withTenant(owner.db, id, async (tx) => {
      await tx.insert(tenants).values({ id, name: `checks-${id.slice(-12)}` });
      const defaults = await tenantSettingsRepository(tx).byId(id);
      predicate = tenantSettingProblems({ ...defaults, ...change }).length === 0;
      const columns = Object.fromEntries(
        Object.entries(change).map(([name, value]) => [columnOf(name as TenantSettingName), value]),
      );
      await tenantSettingsRepository(tx).amend(id, columns);
    });
    return { database: true, predicate };
  } catch (error) {
    if (!(error instanceof TenantSettingCheckViolationError)) throw error;
    return { database: false, predicate };
  }
}

// The partner a range case sets alongside its own field, so an ordering
// that field belongs to cannot refuse first and mask the bound under test:
// the upper partner at its most, or the lower partner at its least.
function orderingPartners(name: string): Partial<Record<TenantSettingName, number>> {
  const partners: Partial<Record<TenantSettingName, number>> = {};
  for (const [lower, upper] of TENANT_SETTING_ORDERINGS) {
    if (name === lower) partners[upper] = TENANT_SETTING_RANGES[upper]?.max ?? INT4_MAX;
    if (name === upper) partners[lower] = TENANT_SETTING_RANGES[lower]?.min ?? 0;
  }
  return partners;
}

const rangeCases = Object.entries(TENANT_SETTING_RANGES).flatMap(([name, range]) => {
  const max = range.max ?? INT4_MAX;
  return [range.min - 1, range.min, max, ...(max < INT4_MAX ? [max + 1] : [])].map((value) => ({
    name,
    value,
    change: { ...orderingPartners(name), [name]: value },
  }));
});

const orderingCases = TENANT_SETTING_ORDERINGS.flatMap(([lower, upper]) => {
  const floor = Math.max(
    TENANT_SETTING_RANGES[lower]?.min ?? 1,
    TENANT_SETTING_RANGES[upper]?.min ?? 1,
  );
  return [
    { change: { [lower]: floor + 1, [upper]: floor }, label: `${lower} above ${upper}` },
    { change: { [lower]: floor, [upper]: floor }, label: `${lower} equal to ${upper}` },
  ];
});

describe('tenantSettingProblems agrees with the CHECK constraints on tenants', () => {
  it('restates every setting column a CHECK on tenants names', async () => {
    const rows = await owner.sql<{ expression: string }[]>`
      select pg_get_constraintdef(con.oid) as expression
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
       where c.relname = 'tenants' and con.contype = 'c'
    `;
    const covered = new Set([
      ...Object.keys(TENANT_SETTING_RANGES),
      ...TENANT_SETTING_ORDERINGS.flat(),
      ...NOT_RANGES,
    ]);
    const named = new Set(
      rows.flatMap((row) => [...row.expression.matchAll(/\b([a-z_]+)\b/gu)].map((m) => m[1] ?? '')),
    );
    const settingColumns = [...named].filter((word) =>
      TENANT_SETTING_COLUMNS.some((column) => column.name === word),
    );

    expect(settingColumns.filter((name) => !covered.has(name)).sort()).toEqual([]);
  });

  // Every comparison of one setting column with another, as
  // pg_get_constraintdef prints it, keyed `lower<=upper` — a strict or
  // reversed comparison keys differently, so it cannot pass for an ordering.
  it('restates every ordering a CHECK on tenants holds between two settings', async () => {
    const rows = await owner.sql<{ expression: string }[]>`
      select pg_get_constraintdef(con.oid) as expression
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
       where c.relname = 'tenants' and con.contype = 'c'
    `;
    const isSetting = (word: string): boolean =>
      TENANT_SETTING_COLUMNS.some((column) => column.name === word);
    const fromDatabase = rows.flatMap((row) =>
      [...row.expression.matchAll(/\(([a-z_]+) (<=|>=|<|>|=|<>) ([a-z_]+)\)/gu)].flatMap((m) => {
        const [, left = '', operator = '', right = ''] = m;
        if (!isSetting(left) || !isSetting(right)) return [];
        if (operator === '<=') return [`${left}<=${right}`];
        if (operator === '>=') return [`${right}<=${left}`];
        return [`${left}${operator}${right}`];
      }),
    );
    const fromPredicate = TENANT_SETTING_ORDERINGS.map(([lower, upper]) => `${lower}<=${upper}`);

    expect(fromDatabase.length).toBeGreaterThan(0);
    expect([...new Set(fromDatabase)].sort()).toEqual([...fromPredicate].sort());
  });

  it.each(rangeCases)('$name = $value', async ({ change }) => {
    const { database, predicate } = await verdicts(change);
    expect(predicate).toBe(database);
  });

  it.each(orderingCases)('$label', async ({ change }) => {
    const { database, predicate } = await verdicts(change);
    expect(predicate).toBe(database);
  });
});
