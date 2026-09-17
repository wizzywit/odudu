/**
 * The ceiling on keys remembered at once. A limiter keyed on a value the
 * caller chooses is a memory-exhaustion vector of its own, so the map is
 * bounded outright rather than trusted to drain: past this, the
 * least-recently-seen key is dropped. The cost of a drop is that the key
 * gets a fresh budget, which is why the coldest goes first — an attacker
 * rotating keys evicts its own history, not the history of whoever is
 * being throttled. ADR 0023 records what this does and does not hold.
 */
export const MAX_THROTTLE_KEYS = 10_000;

export interface SlidingWindowOptions {
  /** Requests a key may make inside one window. */
  readonly limit: number;
  readonly windowSeconds: number;
  readonly now: () => Date;
  readonly maxKeys?: number;
}

export interface ThrottleDecision {
  readonly allowed: boolean;
  /** Zero when allowed; otherwise at least one, never zero. */
  readonly retryAfterSeconds: number;
}

export interface SlidingWindow {
  check: (key: string) => ThrottleDecision;
  /** How many keys are remembered right now — the bound under test. */
  size: () => number;
}

/**
 * A sliding window per key, in this process's memory. A refused request is
 * not recorded, so retrying does not extend the wait the way an attempt
 * during an account lockout does: the two mechanisms answer different
 * questions, and this one is a budget rather than a punishment.
 */
export function slidingWindow(options: SlidingWindowOptions): SlidingWindow {
  const windowMs = options.windowSeconds * 1000;
  const maxKeys = options.maxKeys ?? MAX_THROTTLE_KEYS;
  // Insertion order is recency order: every touched key is deleted and
  // re-set, which moves it to the end.
  const seen = new Map<string, number[]>();

  // One entry per call, which is enough to keep the map to the keys seen
  // inside the window: a key is only ever added by a call.
  const dropColdestIfStale = (cutoff: number): void => {
    const coldest = seen.entries().next();
    if (coldest.done === true) return;
    const [key, hits] = coldest.value;
    if ((hits.at(-1) ?? 0) <= cutoff) seen.delete(key);
  };

  return {
    check: (key) => {
      const now = options.now().getTime();
      const cutoff = now - windowMs;
      dropColdestIfStale(cutoff);

      const hits = (seen.get(key) ?? []).filter((at) => at > cutoff);
      seen.delete(key);
      const refused = hits.length >= options.limit;
      if (!refused) hits.push(now);
      seen.set(key, hits);
      while (seen.size > maxKeys) {
        const coldest = seen.keys().next();
        if (coldest.done === true) break;
        seen.delete(coldest.value);
      }

      if (!refused) return { allowed: true, retryAfterSeconds: 0 };
      const oldest = hits[0] ?? now;
      const waitMs = oldest + windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    },
    size: () => seen.size,
  };
}
