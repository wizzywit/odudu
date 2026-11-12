import {
  BreachedLookupFailed,
  breachedHash,
  type BreachedPasswordSource,
} from '#/service/breached-password';

// The one host a lookup may name. It is a constant and not a setting: a
// tenant administrator cannot point the server at an address of their choosing.
export const REMOTE_BREACHED_HOST = 'api.pwnedpasswords.com';
export const REMOTE_BREACHED_TIMEOUT_MS = 3_000;
// A padded answer is about a thousand 37-byte lines.
export const REMOTE_BREACHED_MAX_BYTES = 128 * 1024;
export const REMOTE_BREACHED_CONCURRENCY_PER_TENANT = 4;

export interface RangeLimit {
  timeoutMs: number;
  maxBytes: number;
}

/** Performs the GET and reads at most `maxBytes` of the answer; it adds no body. */
export type RangeFetch = (url: URL, limit: RangeLimit) => Promise<{ status: number; body: string }>;

export interface ConcurrencyLimiter {
  /** A release function, or null when the key already holds its limit. */
  tryAcquire(key: string): (() => void) | null;
  tenantsInFlight(): number;
}

/**
 * Counts what is in flight per key. A key with nothing in flight holds no
 * entry, so the map is never larger than the number of lookups running.
 */
export function concurrencyLimiter(limit: number): ConcurrencyLimiter {
  const inFlight = new Map<string, number>();
  return {
    tryAcquire(key) {
      const held = inFlight.get(key) ?? 0;
      if (held >= limit) return null;
      inFlight.set(key, held + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (inFlight.get(key) ?? 1) - 1;
        if (left <= 0) inFlight.delete(key);
        else inFlight.set(key, left);
      };
    },
    tenantsInFlight: () => inFlight.size,
  };
}

const RANGE_LINE = /^([0-9A-F]{35}):([0-9]+)$/;

/**
 * Whether `suffix` is listed with a positive count. A count of zero marks
 * padding the service adds to hide the real size, and is not a hit. The
 * suffix is public data, so a plain comparison is enough.
 */
export function parseRange(body: string, suffix: string): boolean {
  if (body.length === 0) throw new BreachedLookupFailed('empty answer');
  let found = false;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const match = RANGE_LINE.exec(line.toUpperCase());
    if (match === null) throw new BreachedLookupFailed('unreadable answer');
    if (match[1] === suffix && Number(match[2]) > 0) found = true;
  }
  return found;
}

export interface RemoteBreachedDeps {
  tenantId: string;
  fetchRange: RangeFetch;
  limiter: ConcurrencyLimiter;
}

/** Sends the five-character prefix of the hash and nothing else of the password. */
export function remoteBreachedSource(deps: RemoteBreachedDeps): BreachedPasswordSource {
  return {
    async isBreached(password) {
      const release = deps.limiter.tryAcquire(deps.tenantId);
      if (release === null) throw new BreachedLookupFailed('too many lookups in flight');
      const { prefix, suffix } = breachedHash(password);
      let timer: NodeJS.Timeout | undefined;
      try {
        const timedOut = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new BreachedLookupFailed('timed out'));
          }, REMOTE_BREACHED_TIMEOUT_MS);
        });
        const answer = await Promise.race([
          deps.fetchRange(new URL(`https://${REMOTE_BREACHED_HOST}/range/${prefix}`), {
            timeoutMs: REMOTE_BREACHED_TIMEOUT_MS,
            maxBytes: REMOTE_BREACHED_MAX_BYTES,
          }),
          timedOut,
        ]);
        if (answer.status !== 200)
          throw new BreachedLookupFailed(`status ${String(answer.status)}`);
        return parseRange(answer.body, suffix);
      } catch (err) {
        if (err instanceof BreachedLookupFailed) throw err;
        throw new BreachedLookupFailed('transport failed', { cause: err });
      } finally {
        clearTimeout(timer);
        release();
      }
    },
  };
}
