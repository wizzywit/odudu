export interface Budget {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface ToolLimiterOptions {
  readonly now: () => Date;
  // What one principal (a person's grant to one agent client) may spend.
  readonly perPrincipal: Budget;
  // What every principal of one tenant may spend together.
  readonly perTenant: Budget;
  readonly maxPrincipals: number;
  readonly maxTenants: number;
  readonly maxConcurrentPerPrincipal: number;
}

// Sixty requests a minute per principal is one a second, past what a model
// working a conversation makes; six hundred a minute per tenant lets ten of
// them run at full rate. At 10,000 tenants and a cap of the same many
// principals the two maps hold at most 20,000 small records.
export const DEFAULT_TOOL_LIMITS: ToolLimiterOptions = {
  now: () => new Date(),
  perPrincipal: { limit: 60, windowSeconds: 60 },
  perTenant: { limit: 600, windowSeconds: 60 },
  maxPrincipals: 10_000,
  maxTenants: 10_000,
  maxConcurrentPerPrincipal: 4,
};

export type Admission =
  | { readonly admitted: true; readonly release: () => void }
  | {
      readonly admitted: false;
      readonly reason: 'principal' | 'tenant' | 'concurrency';
      readonly retryAfterSeconds: number;
    };

export interface ToolLimiter {
  // Takes one request of the principal's budget and one of the tenant's, and
  // one slot of the principal's concurrency until `release` is called.
  admit(tenantId: string, principal: string): Admission;
  size(): { readonly principals: number; readonly tenants: number; readonly inFlight: number };
}

interface Window {
  start: number;
  count: number;
}

// Fixed windows, counted in this process only: with several instances the
// effective limit is the stated one times the instance count, and a shared
// budget is a load-balancing concern. Each map keeps at most its bound, the
// least recently used key leaving first, so a key's cost is a fresh budget and
// whoever rotates keys evicts only their own history. A key is made only from
// a token that verified, so the bound is on principals that exist.
export function createToolLimiter(options: ToolLimiterOptions): ToolLimiter {
  const principals = new Map<string, Window>();
  const tenants = new Map<string, Window>();
  const inFlight = new Map<string, number>();

  const live = (map: Map<string, Window>, key: string, windowMs: number, now: number) => {
    const found = map.get(key);
    return found !== undefined && now - found.start < windowMs ? found : undefined;
  };

  // A key that is refused is as recent as one that is served: a principal that
  // keeps asking past its budget must not be the first to be forgotten.
  const touch = (map: Map<string, Window>, key: string, window: Window): void => {
    map.delete(key);
    map.set(key, window);
  };

  // Windows that have ended are of no use, and the least recently used end
  // first in all but unusual orders, so the oldest are dropped at the head.
  const sweep = (map: Map<string, Window>, windowMs: number, now: number): void => {
    for (const [key, window] of map) {
      if (now - window.start < windowMs) return;
      map.delete(key);
    }
  };

  const spend = (
    map: Map<string, Window>,
    key: string,
    windowMs: number,
    max: number,
    now: number,
  ): void => {
    const window = live(map, key, windowMs, now) ?? { start: now, count: 0 };
    window.count += 1;
    touch(map, key, window);
    sweep(map, windowMs, now);
    while (map.size > max) {
      const coldest = map.keys().next();
      if (coldest.done === true) break;
      map.delete(coldest.value);
    }
  };

  const refused = (
    reason: 'principal' | 'tenant' | 'concurrency',
    endsAt: number,
    now: number,
  ): Admission => ({
    admitted: false,
    reason,
    retryAfterSeconds: Math.max(1, Math.ceil((endsAt - now) / 1000)),
  });

  return {
    admit(tenantId, bare) {
      const principalKey = `${tenantId}\u0000${bare}`;
      const now = options.now().getTime();
      const principalMs = options.perPrincipal.windowSeconds * 1000;
      const tenantMs = options.perTenant.windowSeconds * 1000;

      const held = inFlight.get(principalKey) ?? 0;
      if (held >= options.maxConcurrentPerPrincipal) return refused('concurrency', now, now);

      const tenant = live(tenants, tenantId, tenantMs, now);
      if (tenant !== undefined && tenant.count >= options.perTenant.limit) {
        touch(tenants, tenantId, tenant);
        return refused('tenant', tenant.start + tenantMs, now);
      }
      const principal = live(principals, principalKey, principalMs, now);
      if (principal !== undefined && principal.count >= options.perPrincipal.limit) {
        touch(principals, principalKey, principal);
        return refused('principal', principal.start + principalMs, now);
      }

      spend(tenants, tenantId, tenantMs, options.maxTenants, now);
      spend(principals, principalKey, principalMs, options.maxPrincipals, now);
      inFlight.set(principalKey, held + 1);
      let released = false;
      return {
        admitted: true,
        release() {
          if (released) return;
          released = true;
          const left = (inFlight.get(principalKey) ?? 1) - 1;
          if (left <= 0) inFlight.delete(principalKey);
          else inFlight.set(principalKey, left);
        },
      };
    },
    size: () => ({ principals: principals.size, tenants: tenants.size, inFlight: inFlight.size }),
  };
}
