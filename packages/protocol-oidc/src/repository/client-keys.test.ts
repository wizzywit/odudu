import { describe, expect, it } from 'vitest';
import {
  clientKeySet,
  CACHE_TTL_MS,
  MAX_JWKS_BYTES,
  NEGATIVE_CACHE_TTL_MS,
  type ClientKeyDeps,
} from '#/repository/client-keys';

const TENANT = 'a4f6c1a0-1a1a-4b1a-9c1a-000000000001';
const OTHER_TENANT = 'b4f6c1a0-1a1a-4b1a-9c1a-000000000002';

const deps = (overrides: Partial<ClientKeyDeps> = {}): ClientKeyDeps => ({
  lookup: () => Promise.resolve(['93.184.216.34']),
  request: () =>
    Promise.resolve({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }),
  now: () => new Date('2026-09-18T00:00:00Z'),
  allowPrivate: false,
  ...overrides,
});

function makeClock(start: Date) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

describe('clientKeySet', () => {
  it('resolves once and connects to the address it checked', async () => {
    const connectedTo: string[] = [];
    const keys = clientKeySet(
      deps({
        request: (_url, address) => {
          connectedTo.push(address);
          return Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: '{"keys":[]}',
          });
        },
      }),
    );
    await keys.fetch('https://rp.example/jwks.json', TENANT);
    expect(connectedTo).toEqual(['93.184.216.34']);
  });

  it('refuses a redirect rather than following it', async () => {
    const keys = clientKeySet(
      deps({ request: () => Promise.resolve({ status: 302, contentType: null, body: '' }) }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow(/redirect/u);
  });

  it('refuses a response that is not JSON', async () => {
    const keys = clientKeySet(
      deps({
        request: () => Promise.resolve({ status: 200, contentType: 'text/html', body: '<html>' }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow(/content type/u);
  });

  it.each([
    ['the JWK Set media type RFC 7517 §8.5 registers', 'application/jwk-set+json'],
    ['plain JSON with a charset parameter', 'application/json; charset=utf-8'],
    ['plain JSON, uppercased', 'APPLICATION/JSON'],
  ])('accepts %s', async (_label, contentType) => {
    const keys = clientKeySet(
      deps({ request: () => Promise.resolve({ status: 200, contentType, body: '{"keys":[]}' }) }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).resolves.toEqual({ keys: [] });
  });

  it('refuses a media type that merely starts with application/json', async () => {
    const keys = clientKeySet(
      deps({
        request: () =>
          Promise.resolve({ status: 200, contentType: 'application/jsonish', body: '{}' }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow(/content type/u);
  });

  it('refuses a body past the cap', async () => {
    const keys = clientKeySet(
      deps({
        request: () =>
          Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: 'x'.repeat(MAX_JWKS_BYTES + 1),
          }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow(/too large/u);
  });

  it('serves a second call from the cache inside the TTL', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: '{"keys":[]}',
          });
        },
      }),
    );
    await keys.fetch('https://rp.example/j', TENANT);
    await keys.fetch('https://rp.example/j', TENANT);
    expect(calls).toBe(1);
  });

  it('serves a successful fetch to a second tenant from the same cache entry', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: '{"keys":[]}',
          });
        },
      }),
    );
    await keys.fetch('https://rp.example/j', TENANT);
    await expect(keys.fetch('https://rp.example/j', OTHER_TENANT)).resolves.toEqual({ keys: [] });
    expect(calls).toBe(1);
  });

  it('dates the cache entry from when the fetch finished, not when it started', async () => {
    // The delay equals the TTL itself: if expiresAt were computed from the
    // clock read before the fetch, the entry would already read as expired
    // the instant the fetch returns, and the second call below would miss.
    const clock = makeClock(new Date('2026-09-18T00:00:00Z'));
    let calls = 0;
    const keys = clientKeySet(
      deps({
        now: clock.now,
        request: () => {
          calls += 1;
          clock.advance(CACHE_TTL_MS);
          return Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: '{"keys":[]}',
          });
        },
      }),
    );
    await keys.fetch('https://rp.example/j', TENANT);
    await keys.fetch('https://rp.example/j', TENANT);
    expect(calls).toBe(1);
  });

  it('makes one request when two verifications race for the same uri', async () => {
    let calls = 0;
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const keys = clientKeySet(
      deps({
        request: async () => {
          calls += 1;
          await gate;
          return { status: 200, contentType: 'application/json', body: '{"keys":[]}' };
        },
      }),
    );

    const both = Promise.all([
      keys.fetch('https://rp.example/j', TENANT),
      keys.fetch('https://rp.example/j', TENANT),
    ]);
    releaseFetch?.();
    await both;

    expect(calls).toBe(1);
  });

  it('does not re-fetch a uri that just failed, until the negative entry expires', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.reject(new Error('connrefused'));
        },
      }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('re-fetches once the negative entry expires, reaching the network rather than replaying a poisoned in-flight promise', async () => {
    const clock = makeClock(new Date('2026-09-18T00:00:00Z'));
    let calls = 0;
    const keys = clientKeySet(
      deps({
        now: clock.now,
        request: () => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error('connrefused'));
          return Promise.resolve({
            status: 200,
            contentType: 'application/json',
            body: '{"keys":[]}',
          });
        },
      }),
    );

    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow();
    clock.advance(NEGATIVE_CACHE_TTL_MS + 1);
    // If the failed attempt's in-flight entry were never cleared, this call
    // would still be awaiting that settled-rejected promise and reject too,
    // rather than reaching the network for a second, successful attempt.
    await expect(keys.fetch('https://rp.example/j', TENANT)).resolves.toEqual({ keys: [] });
    expect(calls).toBe(2);
  });

  it('does not let one tenant mark a uri failed for another tenant', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.reject(new Error('connrefused'));
        },
      }),
    );
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j', OTHER_TENANT)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('records a negative entry for a tenant that only joined a failing attempt, not just the one that started it', async () => {
    let calls = 0;
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const keys = clientKeySet(
      deps({
        request: async () => {
          calls += 1;
          await gate;
          throw new Error('connrefused');
        },
      }),
    );

    const raced = Promise.allSettled([
      keys.fetch('https://rp.example/j', TENANT),
      keys.fetch('https://rp.example/j', OTHER_TENANT),
    ]);
    releaseFetch?.();
    const [first, second] = await raced;

    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    expect(calls).toBe(1);

    // Both tenants raced the same attempt; both must have their own negative
    // entry, or the joiner's next call would reach the network again.
    await expect(keys.fetch('https://rp.example/j', TENANT)).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j', OTHER_TENANT)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('never leaves a window, between a failure and its negative entry, where a new call reaches the network', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.reject(new Error('connrefused'));
        },
      }),
    );

    const first = keys.fetch('https://rp.example/j', TENANT).catch(() => undefined);

    // A plain `.then()` chain rather than `await` in a loop, so each sample
    // lands on a known microtask tick instead of wherever the probe's own
    // awaits leave it. Against an implementation that writes the negative
    // entry after clearing `inFlight`, this reports a second network call at
    // ticks 4 through 15 of 16.
    let chain: Promise<unknown> = Promise.resolve();
    const observedAtEachTick: number[] = [];
    for (let tick = 0; tick < 16; tick += 1) {
      chain = chain.then(() => {
        keys.fetch('https://rp.example/j', TENANT).catch(() => undefined);
        observedAtEachTick.push(calls);
      });
    }
    await chain;
    await first;

    expect(Math.max(...observedAtEachTick)).toBe(1);
  });

  // Only a change to one of the two constants can break this; no edit to the
  // fetcher's logic does. Kept because it pins an invariant a future edit
  // could still violate.
  it('gives a failure a shorter life than a success', () => {
    expect(NEGATIVE_CACHE_TTL_MS).toBeLessThan(CACHE_TTL_MS);
  });
});
