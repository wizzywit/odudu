// At most this many issuers are kept; the oldest is dropped first. The
// issuers are the operator's list, so the bound only matters for a very long one.
export const MAX_ISSUERS = 256;
// A key set of more than this many keys is cut to its first 20.
export const MAX_KEYS_PER_ISSUER = 20;
// An issuer's keys are read again for an unknown `kid` no sooner than this
// after they were last read, and a failed read is repeated no sooner either.
export const REFETCH_INTERVAL_MS = 10_000;

export interface Entry<T> {
  startedAt: number;
  expiresAt: number;
  // The request while it is in flight, so concurrent callers share one fetch.
  value: Promise<T>;
}

// A bounded, expiring map. A `Map` iterates in insertion order, so the oldest
// entry is the first key.
export class TimedCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now: number): Entry<T> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: Promise<T>, now: number, ttlMs: number): Entry<T> {
    const entry = { startedAt: now, expiresAt: now + ttlMs, value };
    this.entries.delete(key);
    this.entries.set(key, entry);
    const oldest = this.entries.keys().next();
    if (this.entries.size > MAX_ISSUERS && oldest.done !== true) this.entries.delete(oldest.value);
    return entry;
  }

  // Shortens an entry that failed, so the failure is answered from memory
  // for a while instead of driving a request per token.
  retire(entry: Entry<T>, expiresAt: number): void {
    entry.expiresAt = Math.min(entry.expiresAt, expiresAt);
  }
}

export const mayRefetch = (startedAt: number, now: number): boolean =>
  now - startedAt >= REFETCH_INTERVAL_MS;
