import { describe, expect, it } from 'vitest';
import { resolveCimdDocument, type ResolveCimdDeps } from '#/usecase/resolve-cimd-document';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const later = new Date(NOW.getTime() + 600_000);
const URL_A = 'https://app.example.com/client.json';
const DOC = {
  client_id: URL_A,
  client_name: 'App',
  redirect_uris: ['https://app.example.com/cb'],
  token_endpoint_auth_method: 'none',
};

function setup(over: Partial<ResolveCimdDeps> = {}) {
  const stored: {
    tenantId: string;
    url: string;
    body: unknown;
    expiresAt: Date;
    maxRows: number;
  }[] = [];
  const fetched: string[] = [];
  const deps: ResolveCimdDeps = {
    cache: {
      find: () => Promise.resolve(null),
      store: (tenantId, url, body, _now, expiresAt, maxRows) => {
        stored.push({ tenantId, url, body, expiresAt, maxRows });
        return Promise.resolve();
      },
    },
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve({ kind: 'ok', body: DOC, expiresAt: later, cacheable: true });
    },
    limiter: { tryAcquire: () => true },
    now: () => NOW,
    ...over,
  };
  return { deps, stored, fetched };
}

describe('resolveCimdDocument', () => {
  it('serves a fresh cached document without fetching', async () => {
    const { deps, fetched } = setup({
      cache: {
        find: () => Promise.resolve({ body: { cached: true }, expiresAt: later }),
        store: () => Promise.reject(new Error('must not store')),
      },
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({
      kind: 'ok',
      body: { cached: true },
    });
    expect(fetched).toEqual([]);
  });

  it('fetches on a miss and keeps what may be kept, under the per-tenant ceiling', async () => {
    const { deps, stored } = setup();
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({ kind: 'ok', body: DOC });
    expect(stored).toEqual([
      { tenantId: 't1', url: URL_A, body: DOC, expiresAt: later, maxRows: 1000 },
    ]);
  });

  it('uses a no-store document once and keeps it nowhere', async () => {
    const { deps, stored } = setup({
      fetch: () => Promise.resolve({ kind: 'ok', body: DOC, expiresAt: NOW, cacheable: false }),
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({ kind: 'ok', body: DOC });
    expect(stored).toEqual([]);
  });

  it('keeps nothing of a refused fetch', async () => {
    const { deps, stored } = setup({
      fetch: () => Promise.resolve({ kind: 'refused', reason: 'redirect' }),
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({
      kind: 'refused',
      reason: 'redirect',
    });
    expect(stored).toEqual([]);
  });

  it('serves the fetched document uncached when the store fails', async () => {
    const { deps } = setup({
      cache: {
        find: () => Promise.resolve(null),
        store: () => Promise.reject(new Error('check constraint')),
      },
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({ kind: 'ok', body: DOC });
  });

  it('refuses a document that does not validate, and keeps nothing of it', async () => {
    const { deps, stored } = setup({
      fetch: () =>
        Promise.resolve({
          kind: 'ok',
          body: { ...DOC, client_id: 'https://evil.example/x' },
          expiresAt: later,
          cacheable: true,
        }),
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({
      kind: 'refused',
      reason: 'invalid_document',
    });
    expect(stored).toEqual([]);
  });

  it('refuses without fetching when the limiter says so, naming the URL host', async () => {
    const asked: string[][] = [];
    const { deps, fetched } = setup({
      limiter: {
        tryAcquire: (t, h) => {
          asked.push([t, h]);
          return false;
        },
      },
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({
      kind: 'refused',
      reason: 'rate_limited',
    });
    expect(fetched).toEqual([]);
    expect(asked).toEqual([['t1', 'app.example.com']]);
  });

  it('does not count a cache hit against the limiter', async () => {
    let asked = 0;
    const { deps } = setup({
      cache: {
        find: () => Promise.resolve({ body: DOC, expiresAt: later }),
        store: () => Promise.resolve(),
      },
      limiter: {
        tryAcquire: () => {
          asked += 1;
          return false;
        },
      },
    });
    expect((await resolveCimdDocument('t1', URL_A, deps)).kind).toBe('ok');
    expect(asked).toBe(0);
  });
});
