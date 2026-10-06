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

/**
 * The request an audit row's `request_id`/`ip` columns default from
 * (`packages/domain-audit/src/schema/audit-events.ts`), bound for the life
 * of one `withTenant` transaction. Declared here, not in `@odudu/domain-audit`,
 * because `withTenant` is what binds it.
 */
export interface RequestContext {
  readonly requestId: string | null;
  readonly ip: string | null;
}

export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
  context?: RequestContext,
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
    if (context === undefined) {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    } else {
      await tx.execute(sql`
        select
          set_config('app.tenant_id', ${tenantId}, true),
          set_config('app.request_id', ${context.requestId ?? ''}, true),
          set_config('app.client_ip', ${context.ip ?? ''}, true)
      `);
    }
    return fn(tx as unknown as TenantScopedDatabase);
  });
}

/**
 * One transaction bound to `first` and then to `second`, rebound at its top
 * level as `withEachTenantExclusive` rebinds, never nested: for a change in
 * one tenant whose record belongs to another, so neither commits without
 * the other. `then` receives what `fn` answered.
 */
export async function withTenantThen<A, B>(
  db: Database,
  tenants: readonly [first: string, second: string],
  fn: (tx: TenantScopedDatabase) => Promise<A>,
  then: (tx: TenantScopedDatabase, first: A) => Promise<B>,
  context?: RequestContext,
): Promise<B> {
  for (const tenantId of tenants) {
    if (!UUID_PATTERN.test(tenantId)) {
      throw new OduduError(
        'tenant_context_missing',
        `withTenantThen requires UUID tenant ids, got ${JSON.stringify(tenantId)}`,
      );
    }
  }
  return withTenant(
    db,
    tenants[0],
    async (tx) => {
      const first = await fn(tx);
      await tx.execute(sql`select set_config('app.tenant_id', ${tenants[1]}, true)`);
      return then(tx, first);
    },
    context,
  );
}

interface SavepointCapable {
  transaction<T>(fn: (inner: unknown) => Promise<T>): Promise<T>;
}

/**
 * Runs `fn` so that a statement failing inside it undoes only its own writes
 * and leaves the transaction usable. Safe where a nested `withTenant` is not:
 * it never calls `set_config`, so releasing the savepoint rebinds nothing.
 * The driver's own savepoint is used rather than a raw SAVEPOINT statement,
 * because postgres-js rethrows any failed query at the end of the scope it
 * ran in, caught or not, and only its savepoint opens a scope of its own.
 */
export function withSavepoint<T>(
  tx: TenantScopedDatabase,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
): Promise<T> {
  return (tx as unknown as SavepointCapable).transaction((inner) =>
    fn(inner as TenantScopedDatabase),
  );
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

function isArray(ids: readonly string[] | AsyncIterable<string>): ids is readonly string[] {
  return Array.isArray(ids);
}

function assertTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new OduduError(
      'tenant_context_missing',
      `withEachTenantExclusive requires UUID tenant ids, got ${JSON.stringify(tenantId)}`,
    );
  }
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
  tenantIds: readonly string[] | AsyncIterable<string>,
  fn: (tx: TenantScopedDatabase, tenantId: string) => Promise<T>,
  // Fires with the lock result before this transaction does anything else.
  // Production never passes it; a test uses it to hold a winning attempt
  // open until a concurrent one has made its own attempt on the same key.
  onLockAttempt?: (acquired: boolean) => Promise<void> | void,
): Promise<ExclusiveTenantPass<T>> {
  if (isArray(tenantIds)) {
    for (const tenantId of tenantIds) assertTenantId(tenantId);
  }

  return db.transaction(async (tx) => {
    // pg_try_advisory_xact_lock, never pg_advisory_lock: the session-scoped
    // form outlives this transaction on a pooled connection, so the pass
    // would run once and then silently never again. The xact form releases
    // on commit and on rollback alike, so there is no unlock to forget.
    const rows = await tx.execute(sql`select pg_try_advisory_xact_lock(${lockKey}::bigint) as got`);
    const acquired = (rows as unknown as AdvisoryLockRow[])[0]?.got === true;
    await onLockAttempt?.(acquired);
    // The holder is doing this same work concurrently, so there is nothing
    // a retry could achieve.
    if (!acquired) return { acquired: false };

    // One result per tenant visited, so at most the tenant count: 10,000 at
    // the design volume (ADR 0041).
    const values: T[] = [];
    for await (const tenantId of tenantIds) {
      assertTenantId(tenantId);
      // Re-bound per tenant at the top level of the transaction, never
      // nested: a savepoint releasing is what would make this unsafe, and
      // there is no savepoint here.
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      values.push(await fn(tx as unknown as TenantScopedDatabase, tenantId));
    }
    return { acquired: true, values };
  });
}
