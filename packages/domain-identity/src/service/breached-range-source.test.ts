import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreachedLookupFailed, breachedHash } from '#/service/breached-password';
import {
  REMOTE_BREACHED_MAX_BYTES,
  REMOTE_BREACHED_TIMEOUT_MS,
  concurrencyLimiter,
  parseRange,
  remoteBreachedSource,
  type RangeFetch,
} from '#/service/breached-range-source';

const PASSWORD = 'correct horse battery staple';
const { prefix, suffix } = breachedHash(PASSWORD);
const OTHER = 'ABCDEF0123456789ABCDEF0123456789ABC';

function body(...lines: string[]): string {
  return lines.join('\r\n');
}

function fetcher(response: { status: number; body: string } | Error): RangeFetch & {
  urls: URL[];
  limits: { timeoutMs: number; maxBytes: number }[];
} {
  const urls: URL[] = [];
  const limits: { timeoutMs: number; maxBytes: number }[] = [];
  const fn = ((url, limit) => {
    urls.push(url);
    limits.push(limit);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  }) as RangeFetch & { urls: URL[]; limits: { timeoutMs: number; maxBytes: number }[] };
  fn.urls = urls;
  fn.limits = limits;
  return fn;
}

function sourceOf(fetchRange: RangeFetch, limiter = concurrencyLimiter(4)) {
  return remoteBreachedSource({ tenantId: 't1', fetchRange, limiter });
}

describe('parseRange', () => {
  it('finds a suffix with a positive count', () => {
    expect(parseRange(body(`${OTHER}:3`, `${suffix}:41`), suffix)).toBe(true);
  });

  it('does not count padding, which carries a count of zero', () => {
    expect(parseRange(body(`${OTHER}:3`, `${suffix}:0`), suffix)).toBe(false);
  });

  it('is false for a suffix that is not listed', () => {
    expect(parseRange(body(`${OTHER}:3`), suffix)).toBe(false);
  });

  it('refuses a line that is not a suffix and a count', () => {
    for (const bad of ['', 'not a line', OTHER, `${OTHER}:x`, `${OTHER.slice(1)}:1`]) {
      expect(() => parseRange(body(`${OTHER}:3`, bad), suffix)).toThrow(BreachedLookupFailed);
    }
  });

  it('refuses an empty body, which a padded answer never is', () => {
    expect(() => parseRange('', suffix)).toThrow(BreachedLookupFailed);
  });
});

describe('the remote source', () => {
  it('sends the five-character prefix in the path and nothing else of the password', async () => {
    const fetchRange = fetcher({ status: 200, body: body(`${suffix}:9`) });
    expect(await sourceOf(fetchRange).isBreached(PASSWORD)).toBe(true);
    expect(fetchRange.urls).toHaveLength(1);
    const [url] = fetchRange.urls;
    if (url === undefined) throw new Error('no lookup was made');
    expect(url.href).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    const wire = `${url.href}${url.search}${url.hash}${url.username}${url.password}`;
    expect(wire).not.toContain(suffix);
    expect(wire).not.toContain(encodeURIComponent(PASSWORD));
    expect(wire).not.toContain('correct');
  });

  it('asks within the time and size bounds it is built with', async () => {
    const fetchRange = fetcher({ status: 200, body: body(`${OTHER}:1`) });
    expect(await sourceOf(fetchRange).isBreached(PASSWORD)).toBe(false);
    expect(fetchRange.limits).toEqual([
      { timeoutMs: REMOTE_BREACHED_TIMEOUT_MS, maxBytes: REMOTE_BREACHED_MAX_BYTES },
    ]);
  });

  it('fails the lookup on a status other than 200', async () => {
    await expect(sourceOf(fetcher({ status: 429, body: '' })).isBreached(PASSWORD)).rejects.toThrow(
      BreachedLookupFailed,
    );
  });

  it('fails the lookup when the transport fails, whatever it threw', async () => {
    await expect(
      sourceOf(fetcher(new Error('socket hang up'))).isBreached(PASSWORD),
    ).rejects.toThrow(BreachedLookupFailed);
  });

  it('fails the lookup on a body it cannot read', async () => {
    await expect(
      sourceOf(fetcher({ status: 200, body: 'garbage' })).isBreached(PASSWORD),
    ).rejects.toThrow(BreachedLookupFailed);
  });
});

describe('the lookup bounds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up at the timeout even when the transport never answers', async () => {
    const hung: RangeFetch = () => new Promise(() => undefined);
    const outcome = sourceOf(hung)
      .isBreached(PASSWORD)
      .then(
        () => 'resolved',
        (err: unknown) => err,
      );
    await vi.advanceTimersByTimeAsync(REMOTE_BREACHED_TIMEOUT_MS);
    expect(await outcome).toBeInstanceOf(BreachedLookupFailed);
  });

  it('refuses a lookup beyond the tenant limit and frees the slot when one ends', async () => {
    const limiter = concurrencyLimiter(2);
    const release: ((value: { status: number; body: string }) => void)[] = [];
    const pending: RangeFetch = () =>
      new Promise((resolve) => {
        release.push(resolve);
      });
    const source = sourceOf(pending, limiter);
    const first = source.isBreached(PASSWORD);
    const second = source.isBreached(PASSWORD);
    await expect(source.isBreached(PASSWORD)).rejects.toThrow(BreachedLookupFailed);
    for (const resolve of release) resolve({ status: 200, body: body(`${OTHER}:1`) });
    expect(await Promise.all([first, second])).toEqual([false, false]);
    const third = source.isBreached(PASSWORD);
    release[2]?.({ status: 200, body: body(`${OTHER}:1`) });
    expect(await third).toBe(false);
  });

  it('counts each tenant on its own', () => {
    const limiter = concurrencyLimiter(1);
    const a = limiter.tryAcquire('a');
    expect(a).not.toBeNull();
    expect(limiter.tryAcquire('a')).toBeNull();
    expect(limiter.tryAcquire('b')).not.toBeNull();
  });

  it('forgets a tenant with nothing in flight', () => {
    const limiter = concurrencyLimiter(1);
    limiter.tryAcquire('a')?.();
    expect(limiter.tenantsInFlight()).toBe(0);
  });

  it('frees a slot once however often it is released', () => {
    const limiter = concurrencyLimiter(1);
    const release = limiter.tryAcquire('a');
    release?.();
    release?.();
    expect(limiter.tryAcquire('a')).not.toBeNull();
    expect(limiter.tryAcquire('a')).toBeNull();
  });
});
