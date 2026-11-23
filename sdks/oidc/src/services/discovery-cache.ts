import type { ServerMetadata } from '#/types';

export const MAX_ISSUERS = 256;
export const TTL_MS = 60 * 60 * 1000;

interface Entry {
  expiresAt: number;
  metadata: Promise<ServerMetadata>;
}

// A bounded, expiring map of discovery results by key. A `Map` iterates in
// insertion order, so the oldest entry is the first key. An entry holds the
// request while it is in flight, so concurrent callers share one fetch.
export class DiscoveryCache {
  private readonly entries = new Map<string, Entry>();

  get(key: string, now: number): Promise<ServerMetadata> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.metadata;
  }

  set(key: string, metadata: Promise<ServerMetadata>, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: now + TTL_MS, metadata });
    const oldest = this.entries.keys().next();
    if (this.entries.size > MAX_ISSUERS && oldest.done !== true) this.entries.delete(oldest.value);
  }

  // Forget a request that failed, if it is still the one held.
  drop(key: string, metadata: Promise<ServerMetadata>): void {
    if (this.entries.get(key)?.metadata === metadata) this.entries.delete(key);
  }
}
