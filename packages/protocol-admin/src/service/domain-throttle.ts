// How often a verify may make the server look a host up in DNS. A host is
// looked up at most once per cooldown whichever tenant asks, and a tenant
// makes at most `tenantLimit` lookups per window, so a tenant cannot use the
// endpoint to point lookups at names it has no claim on.
export interface VerifyThrottleOptions {
  readonly hostCooldownMs: number;
  readonly tenantLimit: number;
  readonly tenantWindowMs: number;
  // Entries held per map; the oldest are dropped past it.
  readonly maxEntries: number;
}

export const DEFAULT_VERIFY_THROTTLE: VerifyThrottleOptions = {
  hostCooldownMs: 30_000,
  tenantLimit: 10,
  tenantWindowMs: 60_000,
  maxEntries: 10_000,
};

export type VerifyDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface VerifyThrottle {
  /** Spends a lookup for `host` by `tenantId`, or says how long to wait. */
  take(tenantId: string, host: string, now: Date): VerifyDecision;
}

const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

function trim<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) return;
    map.delete(oldest.value);
  }
}

// In this process only: a deployment of several servers allows each of them
// its own lookup, which still bounds what any one of them is made to resolve.
export function createVerifyThrottle(
  options: VerifyThrottleOptions = DEFAULT_VERIFY_THROTTLE,
): VerifyThrottle {
  const hosts = new Map<string, number>();
  const tenants = new Map<string, number[]>();

  return {
    take(tenantId, host, now) {
      const at = now.getTime();
      const hostUntil = (hosts.get(host) ?? 0) + options.hostCooldownMs;
      if (hostUntil > at) return { allowed: false, retryAfterSeconds: seconds(hostUntil - at) };

      const recent = (tenants.get(tenantId) ?? []).filter((t) => t > at - options.tenantWindowMs);
      const oldest = recent[0];
      if (recent.length >= options.tenantLimit && oldest !== undefined) {
        const until = oldest + options.tenantWindowMs;
        return { allowed: false, retryAfterSeconds: seconds(until - at) };
      }

      hosts.delete(host);
      hosts.set(host, at);
      trim(hosts, options.maxEntries);
      tenants.delete(tenantId);
      tenants.set(tenantId, [...recent, at]);
      trim(tenants, options.maxEntries);
      return { allowed: true };
    },
  };
}
