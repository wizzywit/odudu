import { describe, expect, it } from 'vitest';
import { clientKeySet, MAX_JWKS_BYTES, type ClientKeyDeps } from '#/repository/client-keys';

const deps = (overrides: Partial<ClientKeyDeps> = {}): ClientKeyDeps => ({
  lookup: () => Promise.resolve(['93.184.216.34']),
  request: () =>
    Promise.resolve({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }),
  now: () => new Date('2026-09-18T00:00:00Z'),
  allowPrivate: false,
  ...overrides,
});

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
    await keys.fetch('https://rp.example/jwks.json');
    expect(connectedTo).toEqual(['93.184.216.34']);
  });

  it('refuses a redirect rather than following it', async () => {
    const keys = clientKeySet(
      deps({ request: () => Promise.resolve({ status: 302, contentType: null, body: '' }) }),
    );
    await expect(keys.fetch('https://rp.example/j')).rejects.toThrow(/redirect/u);
  });

  it('refuses a response that is not JSON', async () => {
    const keys = clientKeySet(
      deps({
        request: () => Promise.resolve({ status: 200, contentType: 'text/html', body: '<html>' }),
      }),
    );
    await expect(keys.fetch('https://rp.example/j')).rejects.toThrow(/content type/u);
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
    await expect(keys.fetch('https://rp.example/j')).rejects.toThrow(/too large/u);
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
    await keys.fetch('https://rp.example/j');
    await keys.fetch('https://rp.example/j');
    expect(calls).toBe(1);
  });

  // A key set that will not fetch fails the operation. It is never cached as
  // an absence, and it is never retried per request either.
  it('does not cache a failure as a result', async () => {
    let calls = 0;
    const keys = clientKeySet(
      deps({
        request: () => {
          calls += 1;
          return Promise.reject(new Error('connrefused'));
        },
      }),
    );
    await expect(keys.fetch('https://rp.example/j')).rejects.toThrow();
    await expect(keys.fetch('https://rp.example/j')).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
