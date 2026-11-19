import { type DatabaseHandle } from '@odudu/db';
import { watchedDatabase } from '@odudu/db/testing';
import { loadConfig } from '@odudu/kernel';
import { wantsHtmlPage } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
  ODUDU_LOG_LEVEL: 'silent',
});

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

// A database handle that records every property read of `db`, and every read of
// or call on `sql`, and throws on each, so a test can count touches rather
// than infer them from a status code a failing hook would also produce.
function counting(): { handle: DatabaseHandle; touches: string[] } {
  const touches: string[] = [];
  const record = (what: string): never => {
    touches.push(what);
    throw new Error(`the database was touched: ${what}`);
  };
  const db = watchedDatabase((name) => record(`db.${name}`));
  const handle: DatabaseHandle = {
    db,
    sql: new Proxy(() => undefined, {
      get: (_t, name) => record(`sql.${String(name)}`),
      apply: () => record('sql()'),
    }) as unknown as DatabaseHandle['sql'],
    close: () => Promise.resolve(),
  };
  return { handle, touches };
}

function app(database: DatabaseHandle, extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    tls: false,
    database,
    ownerDatabase: database,
    kek: config.ODUDU_KEK,
    logger: createLogger(config),
    ...extra,
  });
}

describe('the database is never touched by an unrouted answer, counted', () => {
  it('for the 404 page, the 404 problem document and the 500 page and document', async () => {
    const { handle, touches } = counting();
    const server = app(handle);
    server.get('/boom', () => {
      throw new Error('x');
    });
    const cases: [string, string | undefined, number][] = [
      ['/nope', BROWSER, 404],
      ['/tenants/acme/login-actions/nope', BROWSER, 404],
      ['/tenants/no-such-tenant/login-actions/nope/deeper', BROWSER, 404],
      ['/nope', 'application/json', 404],
      ['/tenants/acme/nope', undefined, 404],
      ['/boom', BROWSER, 500],
      ['/boom', 'application/json', 500],
    ];
    for (const [url, accept, status] of cases) {
      const res = await server.inject({
        url,
        ...(accept === undefined ? {} : { headers: { accept } }),
      });
      expect(res.statusCode, `${url} ${String(accept)}`).toBe(status);
    }
    expect(touches).toEqual([]);
    await server.close();
  });

  it('is a detector that fires: a route that reads the database is counted', async () => {
    const { handle, touches } = counting();
    const server = app(handle);
    server.get('/reads', () => typeof handle.db.select);
    await server.inject({ url: '/reads' });
    expect(touches).toEqual(['db.select']);
    await server.close();
  });

  it('looks the same for a tenant that exists and one that does not, by its bytes', async () => {
    const { handle } = counting();
    const server = app(handle);
    const a = await server.inject({
      url: '/tenants/acme/login-actions/nope',
      headers: { accept: BROWSER },
    });
    const b = await server.inject({
      url: '/tenants/zzzz/login-actions/nope',
      headers: { accept: BROWSER },
    });
    expect(a.body).toBe(b.body);
    expect(a.statusCode).toBe(b.statusCode);
    await server.close();
  });
});

// Every route registered under /tenants/:tenant is classed by its first
// segment, so a prefix added later is a program's endpoint until it is named
// here as a browser flow, never a page by default.
describe('every registered tenant route is classed', () => {
  it('serves a page only for the browser flows', async () => {
    const urls = new Set<string>();
    const { handle } = counting();
    const server = app(handle, {
      onRoute: (route) => {
        if (route.url.startsWith('/tenants/:tenant/')) urls.add(route.url);
      },
    });
    await server.ready();
    await server.close();
    const segments = new Set([...urls].map((url) => url.split('/')[3] ?? ''));
    expect([...segments].sort()).toEqual(
      expect.arrayContaining(['.well-known', 'login-actions', 'protocol']),
    );
    const wrong = [...urls].filter((url) => {
      const concrete = url.replace(/:[A-Za-z]+/gu, 'x');
      const isFlow = url.split('/')[3] === 'login-actions';
      return wantsHtmlPage('GET', concrete, BROWSER) !== isFlow;
    });
    expect(wrong).toEqual([]);
  });
});
