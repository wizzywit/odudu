import { OduduError } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type Database } from '#/client';

declare const realmScopedBrand: unique symbol;

/**
 * A database handle bound to one realm's row-level-security context for the
 * life of a `withRealm` transaction. Omits `.transaction()` so that nesting
 * fails to compile: `set_config(..., true)` is transaction-scoped, not
 * savepoint-scoped, so a nested `withRealm` would rebind `app.realm_id` for
 * the rest of the outer transaction once its savepoint released.
 */
export type RealmScopedDatabase = Omit<Database, 'transaction'> & {
  readonly [realmScopedBrand]: true;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withRealm<T>(
  db: Database,
  realmId: string,
  fn: (tx: RealmScopedDatabase) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(realmId)) {
    throw new OduduError(
      'realm_context_missing',
      `withRealm requires a UUID realm id, got ${JSON.stringify(realmId)}`,
    );
  }

  return db.transaction(async (tx) => {
    // set_config(..., true) is the bindable form of SET LOCAL; SET LOCAL itself
    // takes no parameters, and interpolating realmId into DDL would be injectable.
    await tx.execute(sql`select set_config('app.realm_id', ${realmId}, true)`);
    return fn(tx as unknown as RealmScopedDatabase);
  });
}

/**
 * Ran every realm in turn, or found another instance already doing it. A
 * zeroed result and a skipped pass are different answers, so the caller
 * cannot read one as the other.
 */
export type ExclusiveRealmPass<T> =
  { readonly acquired: false } | { readonly acquired: true; readonly values: readonly T[] };

interface AdvisoryLockRow {
  got: boolean;
}

/**
 * One transaction, one Postgres advisory lock, each realm's row-level
 * security context bound in turn — what a maintenance pass that spans every
 * realm needs and `withRealm` cannot give, since a lock must outlive any
 * single realm's statements to mean anything.
 */
export async function withEachRealmExclusive<T>(
  db: Database,
  lockKey: number,
  realmIds: readonly string[],
  fn: (tx: RealmScopedDatabase, realmId: string) => Promise<T>,
): Promise<ExclusiveRealmPass<T>> {
  for (const realmId of realmIds) {
    if (!UUID_PATTERN.test(realmId)) {
      throw new OduduError(
        'realm_context_missing',
        `withEachRealmExclusive requires UUID realm ids, got ${JSON.stringify(realmId)}`,
      );
    }
  }

  return db.transaction(async (tx) => {
    // pg_try_advisory_xact_lock, never pg_advisory_lock: the session-scoped
    // form outlives this transaction on a pooled connection, so the pass
    // would run once and then silently never again. The xact form releases
    // on commit and on rollback alike, so there is no unlock to forget.
    const rows = await tx.execute(sql`select pg_try_advisory_xact_lock(${lockKey}::bigint) as got`);
    const acquired = (rows as unknown as AdvisoryLockRow[])[0]?.got === true;
    // The holder is doing this same work concurrently, so there is nothing
    // a retry could achieve.
    if (!acquired) return { acquired: false };

    const values: T[] = [];
    for (const realmId of realmIds) {
      // Re-bound per realm at the top level of the transaction, never
      // nested: a savepoint releasing is what would make this unsafe, and
      // there is no savepoint here.
      await tx.execute(sql`select set_config('app.realm_id', ${realmId}, true)`);
      values.push(await fn(tx as unknown as RealmScopedDatabase, realmId));
    }
    return { acquired: true, values };
  });
}
