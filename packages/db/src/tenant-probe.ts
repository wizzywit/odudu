import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { type Database } from '#/client';
import { type TenantScopedDatabase, withTenant } from '#/tx';

export interface TenantProbe {
  table: string;
  seed: (tx: TenantScopedDatabase, tenantId: string) => Promise<void>;
}

function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected at least one row, got none');
  }
  return row;
}

/**
 * Probes one repository method rather than the table it reads: seeds a row
 * under tenant A, then calls the method under tenant B with whatever key
 * `seed` returned. A method keyed by an id, a hash or a client_id is not
 * covered by `expectTenantIsolation`, which proves only that the table's rows
 * filter at the SQL level. For a method that mutates, `verifyTenantAUnaffected`
 * confirms tenant A's row survived the tenant-B call — a `consume` that
 * silently succeeds across tenants is worse than a read that does.
 */
export interface CrossTenantMethodProbe<Seeded> {
  seed: (tx: TenantScopedDatabase, tenantId: string) => Promise<Seeded>;
  /**
   * Confirms, under tenant A's own context, that `seed` actually produced a
   * row in the state the test expects before the cross-tenant attempt runs
   * at all. Without this, a `seed` that silently no-ops (a bad fixture, a
   * schema drift) leaves nothing in tenant B to find either — the probe
   * would still pass, on no evidence.
   */
  verifySeeded: (tx: TenantScopedDatabase, seeded: Seeded) => Promise<void>;
  attempt: (tx: TenantScopedDatabase, seeded: Seeded) => Promise<unknown>;
  expectBlocked: (result: unknown) => void;
  verifyTenantAUnaffected?: (tx: TenantScopedDatabase, seeded: Seeded) => Promise<void>;
}

export async function expectCrossTenantMethodProbe<Seeded>(
  db: Database,
  probe: CrossTenantMethodProbe<Seeded>,
): Promise<void> {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  const seeded = await withTenant(db, tenantA, async (tx) => probe.seed(tx, tenantA));
  await withTenant(db, tenantA, async (tx) => probe.verifySeeded(tx, seeded));

  const result = await withTenant(db, tenantB, async (tx) => probe.attempt(tx, seeded));
  probe.expectBlocked(result);

  if (probe.verifyTenantAUnaffected !== undefined) {
    await withTenant(db, tenantA, async (tx) => probe.verifyTenantAUnaffected?.(tx, seeded));
  }
}

/**
 * Seeds one row in tenant A, then asserts tenant B's context cannot see it and
 * that a missing tenant context sees nothing at all. Every repository that
 * touches a tenant table calls this once. Exported from `@odudu/db/testing`
 * so consuming it never adds vitest to the production dependency graph.
 *
 * Only for tenant_id-keyed tables. `tenants`' policy keys on `id`, so seeding
 * it under `withTenant(db, tenantA, ...)` produces a row unrelated to tenantA
 * and proves nothing; probe it directly instead.
 */
export async function expectTenantIsolation(db: Database, probe: TenantProbe): Promise<void> {
  if (probe.table === 'tenants') {
    throw new Error(
      "expectTenantIsolation cannot probe 'tenants': its policy keys on `id`, not `tenant_id`, " +
        'and it already has its own hand-written isolation test.',
    );
  }

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  // The policy's USING expression doubles as its WITH CHECK when no WITH
  // CHECK is declared, so an insert carrying tenantA's id passes the same
  // predicate a read would — seeding under withTenant(db, tenantA, ...) works
  // because of that default, not because inserts are otherwise unchecked.
  await withTenant(db, tenantA, async (tx) => probe.seed(tx, tenantA));

  const fromA = await withTenant(db, tenantA, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(firstRow(fromA as unknown as { n: number }[]).n).toBeGreaterThan(0);

  const fromB = await withTenant(db, tenantB, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(firstRow(fromB as unknown as { n: number }[]).n).toBe(0);

  // Issued directly on db, not inside withTenant: SET LOCAL reverted when the
  // fromB transaction committed, so this carries no tenant context at all.
  const fromNone = await db.execute(
    sql`select count(*)::int as n from ${sql.identifier(probe.table)}`,
  );
  expect(firstRow(fromNone as unknown as { n: number }[]).n).toBe(0);
}
