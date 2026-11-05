export const CIMD_FETCHES_PER_HOST_PER_MINUTE = 10;
export const CIMD_FETCHES_PER_TENANT_PER_MINUTE = 60;
export const CIMD_LIMITER_MAX_HOSTS = 1000;
export const CIMD_LIMITER_MAX_TENANTS = 10_000;

export interface FetchLimiterOptions {
  readonly now: () => Date;
  readonly perHost: number;
  readonly perTenant: number;
  readonly windowMs: number;
  readonly maxHosts: number;
  readonly maxTenants: number;
}

export interface FetchLimiter {
  tryAcquire: (tenantId: string, host: string) => boolean;
  size: () => { hosts: number; tenants: number };
}

interface Window {
  start: number;
  count: number;
}

// In-process fixed windows, so each server instance counts for itself: with
// several instances the effective limit is the stated one times the instance
// count. Each map holds at most its bound, the oldest-inserted key leaving first.
export function createFetchLimiter(options: FetchLimiterOptions): FetchLimiter {
  const hosts = new Map<string, Window>();
  const tenants = new Map<string, Window>();

  const current = (map: Map<string, Window>, key: string, max: number, now: number): Window => {
    const found = map.get(key);
    if (found !== undefined && now - found.start < options.windowMs) return found;
    map.delete(key);
    if (map.size >= max) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
    const fresh = { start: now, count: 0 };
    map.set(key, fresh);
    return fresh;
  };

  return {
    tryAcquire: (tenantId, host) => {
      const now = options.now().getTime();
      const hostWindow = current(hosts, host, options.maxHosts, now);
      const tenantWindow = current(tenants, tenantId, options.maxTenants, now);
      if (hostWindow.count >= options.perHost || tenantWindow.count >= options.perTenant) {
        return false;
      }
      hostWindow.count += 1;
      tenantWindow.count += 1;
      return true;
    },
    size: () => ({ hosts: hosts.size, tenants: tenants.size }),
  };
}
