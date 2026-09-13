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
 * Probes one repository method rather than the table it reads: seeds a row
 * under realm A, then calls the method under realm B with whatever key
 * `seed` returned. A method keyed by an id, a hash or a client_id is not
 * covered by `expectRealmIsolation`, which proves only that the table's rows
 * filter at the SQL level. For a method that mutates, `verifyRealmAUnaffected`
 * confirms realm A's row survived the realm-B call — a `consume` that
 * silently succeeds across realms is worse than a read that does.
 */
export interface CrossRealmMethodProbe<Seeded> {
  seed: (tx: RealmScopedDatabase, realmId: string) => Promise<Seeded>;
  /**
   * Confirms, under realm A's own context, that `seed` actually produced a
   * row in the state the test expects before the cross-realm attempt runs
   * at all. Without this, a `seed` that silently no-ops (a bad fixture, a
   * schema drift) leaves nothing in realm B to find either — the probe
   * would still pass, on no evidence.
   */
  verifySeeded: (tx: RealmScopedDatabase, seeded: Seeded) => Promise<void>;
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
  await withRealm(db, realmA, async (tx) => probe.verifySeeded(tx, seeded));

  const result = await withRealm(db, realmB, async (tx) => probe.attempt(tx, seeded));
  probe.expectBlocked(result);

  if (probe.verifyRealmAUnaffected !== undefined) {
    await withRealm(db, realmA, async (tx) => probe.verifyRealmAUnaffected?.(tx, seeded));
  }
}

/**
 * Seeds one row in realm A, then asserts realm B's context cannot see it and
 * that a missing realm context sees nothing at all. Every repository that
 * touches a tenant table calls this once. Exported from `@odudu/db/testing`
 * so consuming it never adds vitest to the production dependency graph.
 *
 * Only for realm_id-keyed tables. `realms`' policy keys on `id`, so seeding
 * it under `withRealm(db, realmA, ...)` produces a row unrelated to realmA
 * and proves nothing; probe it directly instead.
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
