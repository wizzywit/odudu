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
/**
 * Probes one repository method directly, rather than the table it reads:
 * seeds a row under realm A, then calls the method under realm B's context
 * with whatever key `seed` returned. `expectBlocked` asserts the method
 * could not see it — `null`, `false`, an empty array, or a thrown error,
 * depending on the method's own contract. For a method that mutates, pass
 * `verifyRealmAUnaffected` to confirm realm A's row was left untouched by
 * the realm-B call — a `consume`-style method that silently succeeds across
 * realms is worse than one that only reads across realms.
 *
 * Complements `expectRealmIsolation`: that helper proves a table's rows are
 * filtered by realm at the SQL level, which does not by itself prove that
 * every repository method built on top of it — keyed by an id, a hash, or a
 * client_id rather than by scanning the table — actually gets no result
 * when called from the wrong realm.
 */
export interface CrossRealmMethodProbe<Seeded> {
  seed: (tx: RealmScopedDatabase, realmId: string) => Promise<Seeded>;
  attempt: (tx: RealmScopedDatabase, seeded: Seeded) => Promise<unknown>;
  expectBlocked: (result: unknown) => void;
  verifyRealmAUnaffected?: (tx: RealmScopedDatabase, seeded: Seeded) => Promise<void>;
}

export async function expectCrossRealmMethodProbe<Seeded>(
  db: Database,
  probe: CrossRealmMethodProbe<Seeded>,
): Promise<void> {
  const realmA = crypto.randomUUID();
  const realmB = crypto.randomUUID();

  const seeded = await withRealm(db, realmA, async (tx) => probe.seed(tx, realmA));

  const result = await withRealm(db, realmB, async (tx) => probe.attempt(tx, seeded));
  probe.expectBlocked(result);

  if (probe.verifyRealmAUnaffected !== undefined) {
    await withRealm(db, realmA, async (tx) => probe.verifyRealmAUnaffected?.(tx, seeded));
  }
}

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
