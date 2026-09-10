import { OduduError } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type Database } from '#/client';

declare const realmScopedBrand: unique symbol;

/**
 * A database handle bound to one realm's row-level-security context for the
 * life of a `withRealm` transaction. Deliberately omits `.transaction()`:
 * `set_config(..., true)` is transaction-scoped, not savepoint-scoped, so a
 * nested `withRealm` call opening a savepoint would rebind `app.realm_id` for
 * the rest of the outer transaction once the savepoint released. Without
 * `.transaction`, `withRealm(tx, ...)` cannot typecheck — nesting fails to
 * compile instead of silently rebinding the realm at runtime.
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
