import { withTenant, type Database, type TenantScopedDatabase } from '@odudu/db';
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
