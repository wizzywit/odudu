/** Most keyed calls that may wait for a slot, per process. */
export const KEYED_QUEUE_MAX = 100;
/** Longest a keyed call waits for a slot before it is refused. */
export const KEYED_WAIT_MAX_MS = 10_000;

export type GateEntry =
  | { readonly kind: 'entered'; readonly release: () => void }
  | { readonly kind: 'refused'; readonly reason: 'disabled' | 'queue_full' | 'timeout' | 'gone' };

export interface KeyedGate {
  acquire(signal?: AbortSignal): Promise<GateEntry>;
}

export interface GateOptions {
  readonly queueMax?: number;
  readonly waitMs?: number;
}

interface Waiter {
  readonly resolve: (entry: GateEntry) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Lets at most `limit` keyed calls run at once, first come first served. Each
 * holds a pool connection for its whole handler and the handler may take a
 * second, so the limit has to stay under half the pool for the calls to
 * finish. A call over it waits here, holding no connection, for at most
 * `waitMs` and behind at most `queueMax` others, and is refused past either;
 * one whose caller has gone leaves the queue. A limit of 0 refuses every call.
 */
export function createKeyedGate(limit: number, options: GateOptions = {}): KeyedGate {
  const queueMax = options.queueMax ?? KEYED_QUEUE_MAX;
  const waitMs = options.waitMs ?? KEYED_WAIT_MAX_MS;
  let active = 0;
  const waiting: Waiter[] = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.resolve({ kind: 'entered', release: once(release) });
  };

  return {
    acquire(signal) {
      if (limit < 1) return Promise.resolve({ kind: 'refused', reason: 'disabled' });
      if (signal?.aborted === true) return Promise.resolve({ kind: 'refused', reason: 'gone' });
      if (active < limit) {
        active += 1;
        return Promise.resolve({ kind: 'entered', release: once(release) });
      }
      if (waiting.length >= queueMax) {
        return Promise.resolve({ kind: 'refused', reason: 'queue_full' });
      }
      return new Promise<GateEntry>((resolve) => {
        const leave = (reason: 'timeout' | 'gone') => () => {
          const at = waiting.indexOf(waiter);
          if (at === -1) return;
          waiting.splice(at, 1);
          clearTimeout(waiter.timer);
          resolve({ kind: 'refused', reason });
        };
        const waiter: Waiter = { resolve, timer: setTimeout(leave('timeout'), waitMs) };
        waiting.push(waiter);
        signal?.addEventListener('abort', leave('gone'), { once: true });
      });
    },
  };
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

/**
 * The most keyed calls a pool of `poolMax` connections can carry, one
 * connection spare. A pool of one carries none: a call would hold the only
 * connection and wait for a second.
 */
export function keyedLimitFor(poolMax: number): number {
  return poolMax < 2 ? 0 : Math.max(1, Math.floor((poolMax - 1) / 2));
}
