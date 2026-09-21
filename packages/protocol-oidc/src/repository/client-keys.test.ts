import { describe, expect, it } from 'vitest';
import {
  clientKeySet,
  CACHE_TTL_MS,
  MAX_JWKS_BYTES,
  NEGATIVE_CACHE_TTL_MS,
  type ClientKeyDeps,
} from '#/repository/client-keys';

const REALM = 'a4f6c1a0-1a1a-4b1a-9c1a-000000000001';
const OTHER_REALM = 'b4f6c1a0-1a1a-4b1a-9c1a-000000000002';

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
    await keys.fetch('https://rp.example/jwks.json', REALM);
    expect(connectedTo).toEqual(['93.184.216.34']);
  });

  it('refuses a redirect rather than following it', async () => {
    const keys = clientKeySet(
      deps({ request: () => Promise.resolve({ status: 302, contentType: null, body: '' }) }),
    );
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow(/redirect/u);
  });

  it('refuses a response that is not JSON', async () => {
    const keys = clientKeySet(
      deps({
        request: () => Promise.resolve({ status: 200, contentType: 'text/html', body: '<html>' }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow(/content type/u);
  });

  it.each([
    ['the JWK Set media type RFC 7517 §8.5 registers', 'application/jwk-set+json'],
    ['plain JSON with a charset parameter', 'application/json; charset=utf-8'],
    ['plain JSON, uppercased', 'APPLICATION/JSON'],
  ])('accepts %s', async (_label, contentType) => {
    const keys = clientKeySet(
      deps({ request: () => Promise.resolve({ status: 200, contentType, body: '{"keys":[]}' }) }),
    );
    await expect(keys.fetch('https://rp.example/j', REALM)).resolves.toEqual({ keys: [] });
  });

  it('refuses a media type that merely starts with application/json', async () => {
    const keys = clientKeySet(
      deps({
        request: () =>
          Promise.resolve({ status: 200, contentType: 'application/jsonish', body: '{}' }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow(/content type/u);
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
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow(/too large/u);
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
    await keys.fetch('https://rp.example/j', REALM);
    await keys.fetch('https://rp.example/j', REALM);
    expect(calls).toBe(1);
  });

  it('serves a successful fetch to a second realm from the same cache entry', async () => {
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
    await keys.fetch('https://rp.example/j', REALM);
    await expect(keys.fetch('https://rp.example/j', OTHER_REALM)).resolves.toEqual({ keys: [] });
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
    await keys.fetch('https://rp.example/j', REALM);
    await keys.fetch('https://rp.example/j', REALM);
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
      keys.fetch('https://rp.example/j', REALM),
      keys.fetch('https://rp.example/j', REALM),
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
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow();
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

    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow();
    clock.advance(NEGATIVE_CACHE_TTL_MS + 1);
    // If the failed attempt's in-flight entry were never cleared, this call
    // would still be awaiting that settled-rejected promise and reject too,
    // rather than reaching the network for a second, successful attempt.
    await expect(keys.fetch('https://rp.example/j', REALM)).resolves.toEqual({ keys: [] });
    expect(calls).toBe(2);
  });

  it('does not let one realm mark a uri failed for another realm', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.reject(new Error('connrefused'));
        },
      }),
    );
    await expect(keys.fetch('https://rp.example/j', REALM)).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j', OTHER_REALM)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  // Only a change to one of the two constants can break this; no edit to the
  // fetcher's logic does. Kept because it pins an invariant a future edit
  // could still violate.
  it('gives a failure a shorter life than a success', () => {
    expect(NEGATIVE_CACHE_TTL_MS).toBeLessThan(CACHE_TTL_MS);
  });
});
