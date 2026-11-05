import { type RegistrationLimiter } from '@odudu/protocol-oidc';
import { type SlidingWindowOptions } from '#/rate-limiter';
import { slidingWindow } from '#/throttle';
import { throttleOrigin } from '#/throttle-origin';

type Budget = Pick<SlidingWindowOptions, 'limit' | 'windowSeconds'>;

export interface McpRegistrationBudgetOptions {
  readonly perOrigin: Budget;
  readonly perTenant: Budget;
  readonly now: SlidingWindowOptions['now'];
}

/**
 * The budget of the `mcp` registration policy: one per tenant and address,
 * and one per tenant over every address, so many addresses together cannot
 * fill a tenant's `max_clients`. The address is checked first, so an address
 * already refused spends none of the tenant's. Each limiter holds at most
 * `MAX_THROTTLE_KEYS` keys (ADR 0023): one timestamp per request in the window
 * for each.
 */
export function mcpRegistrationBudget(options: McpRegistrationBudgetOptions): RegistrationLimiter {
  const origins = slidingWindow({ ...options.perOrigin, now: options.now });
  const tenants = slidingWindow({ ...options.perTenant, now: options.now });
  return {
    check: (tenantId, origin) => {
      const own = origins.check(`${tenantId}:${throttleOrigin(origin)}`);
      if (!own.allowed) return { ...own, scope: 'address' };
      const all = tenants.check(tenantId);
      return all.allowed ? all : { ...all, scope: 'tenant' };
    },
  };
}
