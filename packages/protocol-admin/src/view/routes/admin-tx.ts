import { withTenant, withTenantThen, type Database, type TenantScopedDatabase } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { type FastifyRequest } from 'fastify';

/**
 * Every admin route's own `withTenant`: binds the request's id and address
 * alongside the tenant, so an audit row this transaction writes carries
 * `request_id`/`ip` without a handler ever passing them by hand. Routes
 * under `view/routes/` call this rather than `withTenant` directly —
 * `admin-tx.test.ts` enforces it.
 */
export function adminTx<T>(
  db: Database,
  request: FastifyRequest,
  tenantId: string,
  fn: (tx: TenantScopedDatabase) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenantId, fn, requestContextFrom(request));
}

/** `adminTx` for work in one tenant whose audit row belongs to another. */
export function adminTxThen<A, B>(
  db: Database,
  request: FastifyRequest,
  tenants: readonly [first: string, second: string],
  fn: (tx: TenantScopedDatabase) => Promise<A>,
  then: (tx: TenantScopedDatabase, first: A) => Promise<B>,
): Promise<B> {
  return withTenantThen(db, tenants, fn, then, requestContextFrom(request));
}
