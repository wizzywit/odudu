import { describe, expect, it } from 'vitest';
import { resolveCimdDocument, type ResolveCimdDeps } from '#/usecase/resolve-cimd-document';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const later = new Date(NOW.getTime() + 600_000);
const URL_A = 'https://app.example.com/client.json';

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
      return Promise.resolve({ kind: 'ok', body: { v: 1 }, expiresAt: later, cacheable: true });
    },
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
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({ kind: 'ok', body: { v: 1 } });
    expect(stored).toEqual([
      { tenantId: 't1', url: URL_A, body: { v: 1 }, expiresAt: later, maxRows: 1000 },
    ]);
  });

  it('uses a no-store document once and keeps it nowhere', async () => {
    const { deps, stored } = setup({
      fetch: () =>
        Promise.resolve({ kind: 'ok', body: { v: 1 }, expiresAt: NOW, cacheable: false }),
    });
    expect(await resolveCimdDocument('t1', URL_A, deps)).toEqual({ kind: 'ok', body: { v: 1 } });
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
});
