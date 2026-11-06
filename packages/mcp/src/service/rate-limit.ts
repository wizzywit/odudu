export interface Budget {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface ToolLimiterOptions {
  readonly now: () => Date;
  // What one principal (a person's grant to one agent client) may spend.
  readonly perPrincipal: Budget;
  // What one person may spend across every client they have, so a member who
  // registers many clients does not spend the tenant's.
  readonly perSubject: Budget;
  // What every principal of one tenant may spend together.
  readonly perTenant: Budget;
  readonly maxPrincipals: number;
  readonly maxSubjects: number;
  readonly maxTenants: number;
  readonly maxConcurrentPerPrincipal: number;
}

// Sixty requests a minute is one a second, past what a model working a
// conversation makes; a person may use two clients' worth and a tenant ten
// people's. Each key is three numbers, so at the caps below the three maps hold
// about 160,000 small records: 100,000 principals (ten active ones for each of
// 10,000 tenants), 50,000 people and 10,000 tenants. Past a cap the least
// recently used key goes and gets a fresh budget, which costs a rotating
// caller only its own history.
export const DEFAULT_TOOL_LIMITS: ToolLimiterOptions = {
  now: () => new Date(),
  perPrincipal: { limit: 60, windowSeconds: 60 },
  perSubject: { limit: 120, windowSeconds: 60 },
  perTenant: { limit: 600, windowSeconds: 60 },
  maxPrincipals: 100_000,
  maxSubjects: 50_000,
  maxTenants: 10_000,
  maxConcurrentPerPrincipal: 4,
};

type Reason = 'principal' | 'subject' | 'tenant' | 'concurrency';

export type Admission =
  | { readonly admitted: true; readonly release: () => void }
  | { readonly admitted: false; readonly reason: Reason; readonly retryAfterSeconds: number };

export interface ToolLimiter {
  // Takes one request of the principal's, the person's and the tenant's
  // budgets, and one slot of the principal's concurrency until `release`.
  admit(tenantId: string, subjectId: string, clientId: string): Admission;
  size(): {
    readonly principals: number;
    readonly subjects: number;
    readonly tenants: number;
    readonly inFlight: number;
  };
}

// A sliding window counted in two fixed ones: the window before and this one,
// the estimate being the earlier count weighted by how much of it still lies
// inside the last window, plus this one's. A burst astride a boundary is
// therefore bounded by the limit, not twice it.
interface Counts {
  window: number;
  previous: number;
  current: number;
}

// Counted in this process only: with several instances the effective limit is
// the stated one times the instance count, and a shared budget is a
// load-balancing concern.
export function createToolLimiter(options: ToolLimiterOptions): ToolLimiter {
  const principals = new Map<string, Counts>();
  const subjects = new Map<string, Counts>();
  const tenants = new Map<string, Counts>();
  const inFlight = new Map<string, number>();

  // The record for `key` rolled to the window `now` is in, or none.
  const live = (map: Map<string, Counts>, key: string, windowMs: number, now: number) => {
    const counts = map.get(key);
    if (counts === undefined) return undefined;
    const window = Math.floor(now / windowMs);
    if (counts.window !== window) {
      counts.previous = counts.window === window - 1 ? counts.current : 0;
      counts.current = 0;
      counts.window = window;
    }
    return counts;
  };

  const estimate = (counts: Counts, windowMs: number, now: number): number => {
    const elapsed = (now - counts.window * windowMs) / windowMs;
    return counts.previous * (1 - elapsed) + counts.current;
  };

  // Seconds until the estimate admits one more: the earlier window's weight
  // falls linearly, so solve for the instant it does; when this window's own
  // count is the limit nothing helps until the next window has opened.
  const waitSeconds = (counts: Counts, budget: Budget, now: number): number => {
    const windowMs = budget.windowSeconds * 1000;
    const elapsed = (now - counts.window * windowMs) / windowMs;
    const room = budget.limit - 1 - counts.current;
    const ms =
      room >= 0 && counts.previous > 0
        ? (1 - room / counts.previous - elapsed) * windowMs
        : (1 - elapsed) * windowMs + windowMs / budget.limit;
    return Math.max(1, Math.ceil(ms / 1000));
  };

  const touch = (map: Map<string, Counts>, key: string, counts: Counts): void => {
    map.delete(key);
    map.set(key, counts);
  };

  const sweep = (map: Map<string, Counts>, windowMs: number, now: number): void => {
    const window = Math.floor(now / windowMs);
    for (const [key, counts] of map) {
      if (counts.window > window - 2) return;
      map.delete(key);
    }
  };

  // Null when the key may spend one more, else the seconds to wait. A refused
  // key is as recent as a served one: a caller that keeps asking past its budget
  // must not be the first to be forgotten.
  const verdict = (
    map: Map<string, Counts>,
    key: string,
    budget: Budget,
    now: number,
  ): number | null => {
    const windowMs = budget.windowSeconds * 1000;
    const counts = live(map, key, windowMs, now);
    if (counts === undefined) return null;
    if (estimate(counts, windowMs, now) + 1 <= budget.limit) return null;
    touch(map, key, counts);
    return waitSeconds(counts, budget, now);
  };

  const spend = (
    map: Map<string, Counts>,
    key: string,
    budget: Budget,
    max: number,
    now: number,
  ): void => {
    const windowMs = budget.windowSeconds * 1000;
    const counts = live(map, key, windowMs, now) ?? {
      window: Math.floor(now / windowMs),
      previous: 0,
      current: 0,
    };
    counts.current += 1;
    touch(map, key, counts);
    sweep(map, windowMs, now);
    while (map.size > max) {
      const coldest = map.keys().next();
      if (coldest.done === true) break;
      map.delete(coldest.value);
    }
  };

  const refused = (reason: Reason, retryAfterSeconds: number): Admission => ({
    admitted: false,
    reason,
    retryAfterSeconds,
  });

  return {
    admit(tenantId, subjectId, clientId) {
      const subjectKey = `${tenantId}\u0000${subjectId}`;
      const principalKey = `${subjectKey}\u0000${clientId}`;
      const now = options.now().getTime();

      const held = inFlight.get(principalKey) ?? 0;
      if (held >= options.maxConcurrentPerPrincipal) return refused('concurrency', 1);

      const waits: readonly (readonly [Reason, number | null])[] = [
        ['tenant', verdict(tenants, tenantId, options.perTenant, now)],
        ['subject', verdict(subjects, subjectKey, options.perSubject, now)],
        ['principal', verdict(principals, principalKey, options.perPrincipal, now)],
      ];
      for (const [reason, wait] of waits) if (wait !== null) return refused(reason, wait);

      spend(tenants, tenantId, options.perTenant, options.maxTenants, now);
      spend(subjects, subjectKey, options.perSubject, options.maxSubjects, now);
      spend(principals, principalKey, options.perPrincipal, options.maxPrincipals, now);
      inFlight.set(principalKey, held + 1);
      let released = false;
      return {
        admitted: true,
        release: () => {
          if (released) return;
          released = true;
          const left = (inFlight.get(principalKey) ?? 1) - 1;
          if (left <= 0) inFlight.delete(principalKey);
          else inFlight.set(principalKey, left);
        },
      };
    },
    size: () => ({
      principals: principals.size,
      subjects: subjects.size,
      tenants: tenants.size,
      inFlight: inFlight.size,
    }),
  };
}
