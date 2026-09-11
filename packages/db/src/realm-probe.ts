import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { type Database } from '#/client';
import { type RealmScopedDatabase, withRealm } from '#/tx';

export interface RealmProbe {
  table: string;
  seed: (tx: RealmScopedDatabase, realmId: string) => Promise<void>;
}

function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected at least one row, got none');
  }
  return row;
}

/**
 * Seeds one row in realm A, then asserts realm B's context cannot see it and
 * that a missing realm context sees nothing at all. Every repository that
 * touches a tenant table calls this once. Exported from `@odudu/db/testing`,
 * not the package's main entry point, so consuming this in a test never adds
 * vitest to the production dependency graph.
 *
 * Only for realm_id-keyed tenant tables. `realms` itself is a tenant table
 * whose policy keys on `id`, not `realm_id`: seeding it inside
 * `withRealm(db, realmA, ...)` would insert a row whose primary key is
 * unrelated to realmA, so the isolation this helper proves would not hold.
 * Probe `realms` directly instead of through this helper.
 */
export async function expectRealmIsolation(db: Database, probe: RealmProbe): Promise<void> {
  if (probe.table === 'realms') {
    throw new Error(
      "expectRealmIsolation cannot probe 'realms': its policy keys on `id`, not `realm_id`, " +
        'and it already has its own hand-written isolation test.',
    );
  }

  const realmA = crypto.randomUUID();
  const realmB = crypto.randomUUID();

  // The policy's USING expression doubles as its WITH CHECK when no WITH
  // CHECK is declared, so an insert carrying realmA's id passes the same
  // predicate a read would — seeding under withRealm(db, realmA, ...) works
  // because of that default, not because inserts are otherwise unchecked.
  await withRealm(db, realmA, async (tx) => probe.seed(tx, realmA));

  const fromA = await withRealm(db, realmA, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(firstRow(fromA as unknown as { n: number }[]).n).toBeGreaterThan(0);

  const fromB = await withRealm(db, realmB, async (tx) =>
    tx.execute(sql`select count(*)::int as n from ${sql.identifier(probe.table)}`),
  );
  expect(firstRow(fromB as unknown as { n: number }[]).n).toBe(0);
}
