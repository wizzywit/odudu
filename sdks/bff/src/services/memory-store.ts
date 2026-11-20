import type { Session, SessionStore } from '#/types';

export interface MemoryStoreOptions {
  maxSessions?: number;
  idleMs?: number;
  // Milliseconds since the epoch; replaceable so a test needs no real wait.
  now?: () => number;
}

interface Entry {
  session: Session;
  expiresAt: number;
  lastUsed: number;
}

// A store for one process. It keeps at most `maxSessions` records, dropping
// the one used longest ago when a new one arrives, and drops a record unused
// for `idleMs` or kept past its `ttlMs`. A Map iterates in insertion order and
// every use re-inserts, so the oldest-used record is always first: a sweep
// removes expired records from the front and stops at the first live one, and
// each record is removed once, which makes insertion O(1) amortised with no
// timer. A record past its `ttlMs` that is not at the front is dropped when
// read or when it reaches the front.
export function createMemoryStore(options: MemoryStoreOptions = {}): SessionStore {
  const { maxSessions = 10_000, idleMs = 1_800_000, now = Date.now } = options;
  const entries = new Map<string, Entry>();

  const expired = (entry: Entry, at: number): boolean =>
    at >= entry.expiresAt || at - entry.lastUsed >= idleMs;

  function sweep(at: number): void {
    for (const [id, entry] of entries) {
      if (!expired(entry, at)) return;
      entries.delete(id);
    }
  }

  function evictToFit(): void {
    while (entries.size >= maxSessions) {
      const oldest = entries.keys().next();
      if (oldest.done === true) return;
      entries.delete(oldest.value);
    }
  }

  return {
    get(id) {
      const at = now();
      const entry = entries.get(id);
      if (entry === undefined) return Promise.resolve(undefined);
      entries.delete(id);
      if (expired(entry, at)) return Promise.resolve(undefined);
      entries.set(id, { ...entry, lastUsed: at });
      return Promise.resolve(entry.session);
    },
    set(id, session, ttlMs) {
      const at = now();
      entries.delete(id);
      sweep(at);
      evictToFit();
      entries.set(id, { session, expiresAt: at + ttlMs, lastUsed: at });
      return Promise.resolve();
    },
    delete(id) {
      entries.delete(id);
      return Promise.resolve();
    },
  };
}
