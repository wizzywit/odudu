import {
  withSavepoint,
  withTenant,
  withTenantThen,
  type Database,
  type TenantScopedDatabase,
} from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { type FastifyRequest } from 'fastify';

interface RequestTransaction {
  readonly tenantId: string;
  readonly tx: TenantScopedDatabase;
  joined: boolean;
  readonly after: (() => void)[];
}

const OPEN = new WeakMap<FastifyRequest, RequestTransaction>();

/**
 * Runs `fn` with `tx` as the transaction every `adminTx` of this request for
 * `tenantId` joins, so what a handler writes and what the caller records
 * about it commit together. Answers whether the handler joined it at all: one
 * that opened a transaction of its own wrote outside it.
 */
export async function withRequestTransaction<T>(
  request: FastifyRequest,
  tenantId: string,
  tx: TenantScopedDatabase,
  fn: () => Promise<T>,
): Promise<{ value: T; joined: boolean; after: readonly (() => void)[] }> {
  const open: RequestTransaction = { tenantId, tx, joined: false, after: [] };
  OPEN.set(request, open);
  try {
    const value = await fn();
    return { value, joined: open.joined, after: open.after };
  } finally {
    OPEN.delete(request);
  }
}

/**
 * Runs `effect` once what the request wrote is committed: at once for a
 * request with no transaction held open for it, and after the commit for one
 * that has (a keyed call), so what it drops from a cache cannot be filled
 * again from the data it replaces. Dropped when the call is undone.
 */
export function afterCommit(request: FastifyRequest, effect: () => void): void {
  const open = OPEN.get(request);
  if (open === undefined) effect();
  else open.after.push(effect);
}

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
  const open = OPEN.get(request);
  if (open?.tenantId === tenantId) {
    open.joined = true;
    // A savepoint, so a statement that fails inside `fn` undoes only its own
    // writes and leaves the request's transaction usable, as a transaction
    // of its own would.
    return withSavepoint(open.tx, fn);
  }
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
