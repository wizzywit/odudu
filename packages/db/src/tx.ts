import { OduduError } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type Database } from '#/client';

declare const tenantScopedBrand: unique symbol;

/**
 * A database handle bound to one tenant's row-level-security context for the
 * life of a `withTenant` transaction. Omits `.transaction()` so that nesting
 * fails to compile: `set_config(..., true)` is transaction-scoped, not
 * savepoint-scoped, so a nested `withTenant` would rebind `app.tenant_id` for
 * the rest of the outer transaction once its savepoint released.
 */
export type TenantScopedDatabase = Omit<Database, 'transaction'> & {
  readonly [tenantScopedBrand]: true;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new OduduError(
      'tenant_context_missing',
      `withTenant requires a UUID tenant id, got ${JSON.stringify(tenantId)}`,
    );
  }

  return db.transaction(async (tx) => {
    // set_config(..., true) is the bindable form of SET LOCAL; SET LOCAL itself
    // takes no parameters, and interpolating tenantId into DDL would be injectable.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as TenantScopedDatabase);
  });
}

/**
 * Ran every tenant in turn, or found another instance already doing it. A
 * zeroed result and a skipped pass are different answers, so the caller
 * cannot read one as the other.
 */
export type ExclusiveTenantPass<T> =
  { readonly acquired: false } | { readonly acquired: true; readonly values: readonly T[] };

interface AdvisoryLockRow {
  got: boolean;
}

/**
 * One transaction, one Postgres advisory lock, each tenant's row-level
 * security context bound in turn — what a maintenance pass that spans every
 * tenant needs and `withTenant` cannot give, since a lock must outlive any
 * single tenant's statements to mean anything.
 */
export async function withEachTenantExclusive<T>(
  db: Database,
  lockKey: number,
  tenantIds: readonly string[],
  fn: (tx: TenantScopedDatabase, tenantId: string) => Promise<T>,
): Promise<ExclusiveTenantPass<T>> {
  for (const tenantId of tenantIds) {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new OduduError(
        'tenant_context_missing',
        `withEachTenantExclusive requires UUID tenant ids, got ${JSON.stringify(tenantId)}`,
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
    for (const tenantId of tenantIds) {
      // Re-bound per tenant at the top level of the transaction, never
      // nested: a savepoint releasing is what would make this unsafe, and
      // there is no savepoint here.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      values.push(await fn(tx as unknown as TenantScopedDatabase, tenantId));
    }
    return { acquired: true, values };
  });
}
