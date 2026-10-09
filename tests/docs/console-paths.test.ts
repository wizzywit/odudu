import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { createLogger } from '../../apps/server/src/logger.js';
import { CONSOLE_KEYS } from '../../apps/server/src/testing/console-key.js';
import { type DatabaseHandle } from '../../packages/db/src/index.js';
import { loadConfig } from '../../packages/kernel/src/index.js';
import { backticked, fencedBlocks, loadDocument, sections } from './markdown.js';

const GUIDE = 'docs/console-paths.md';
const BASE = 'http://localhost:3000';

// Nothing here reaches the database: the app is built only so its router can
// be asked what it serves. The gateway sizes its refresh semaphore from the
// pool, so the stand-in carries a pool size.
const database: DatabaseHandle = {
  db: {} as DatabaseHandle['db'],
  sql: Object.assign(() => Promise.resolve([]), {
    options: { max: 10 },
  }) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

// Routes the gateway registers only to answer 404 for its own prefix, so that
// the shell's `/console/*` cannot claim an unknown API or sign-in path. A
// documented path that lands on one of these is a path nothing serves.
const PREFIX_CLAIMS = new Set([
  '/console/api',
  '/console/api/*',
  '/console/auth',
  '/console/auth/*',
]);

interface Route {
  readonly method: string;
  readonly url: string;
}

async function consoleRoutes(): Promise<Route[]> {
  const config = loadConfig({
    ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
    ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
    ODUDU_LOG_LEVEL: 'silent',
  });
  const app = buildApp({
    database,
    ownerDatabase: database,
    kek: config.ODUDU_KEK,
    logger: createLogger(config),
    consoleBaseUrl: BASE,
    consoleKeys: CONSOLE_KEYS,
    consoleDir: '/nonexistent/odudu-console-docs-check',
  });
  const routes: Route[] = [];
  app.addHook('onRoute', (options) => {
    const methods = Array.isArray(options.method) ? options.method : [options.method];
    for (const method of methods) routes.push({ method, url: options.url });
  });
  await app.ready();
  await app.close();
  const found = routes.filter((route) => route.url.startsWith('/console'));
  if (found.length === 0) throw new Error('the app registered no /console routes');
  return found;
}

function staticPrefix(pattern: string): number {
  const cut = pattern.search(/[:*]/u);
  return cut === -1 ? Number.MAX_SAFE_INTEGER : cut;
}

function matches(pattern: string, path: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/:[A-Za-z]+/gu, '[^/]+'))
    .join('.*');
  return new RegExp(`^${source}$`, 'u').test(path);
}

/** The route the router would pick: the most specific pattern that matches. */
function servingRoute(routes: readonly Route[], request: Route): string | undefined {
  const candidates = routes
    .filter((route) => route.method === request.method && matches(route.url, request.url))
    .sort((a, b) => staticPrefix(b.url) - staticPrefix(a.url));
  const chosen = candidates[0]?.url;
  return chosen === undefined || PREFIX_CLAIMS.has(chosen) ? undefined : chosen;
}

const ENDPOINT_IN_HEADING = /^(?<method>GET|POST|PUT|PATCH|DELETE) (?<path>\/console\S*)$/u;
const CONSOLE_URL = /http:\/\/localhost:\d+(?<path>\/console(?:\/[^\s'"?]*)?)(?=[\s'"?]|$)/u;

// `{tenant}` reads as a placeholder to a person; any one segment serves it.
function concrete(path: string): string {
  return path.replace(/\{[A-Za-z]+\}/gu, 'x');
}

function requestLines(): Route[] {
  const document = loadDocument(GUIDE);
  const fromHeadings = sections(document, 8).flatMap((section) =>
    backticked(section.heading).flatMap((item) => {
      const match = ENDPOINT_IN_HEADING.exec(item.trim());
      if (match === null) return [];
      return [{ method: match.groups?.method ?? '', url: concrete(match.groups?.path ?? '') }];
    }),
  );
  const fromCommands = fencedBlocks(document)
    .filter((block) => block.language === 'bash')
    .flatMap((block) => block.body.replace(/\\\n/gu, ' ').split('\n'))
    .filter((command) => command.trim().startsWith('curl '))
    .flatMap((command) => {
      const path = CONSOLE_URL.exec(command)?.groups?.path;
      if (path === undefined) return [];
      const method = /-X (?<method>[A-Z]+)/u.exec(command)?.groups?.method ?? 'GET';
      return [{ method, url: path }];
    });
  return [...fromHeadings, ...fromCommands];
}

describe('docs/console-paths.md names only console routes the server serves', () => {
  it('finds the request lines, so a broken extractor fails rather than checking nothing', () => {
    // 20 when this was written: 8 headings and 12 curl commands.
    expect(requestLines().length).toBeGreaterThanOrEqual(16);
  });

  it('reads a request to any local port, not only the default one', () => {
    const assets = requestLines().filter((request) => request.url.startsWith('/console/assets/'));
    expect(assets.length).toBeGreaterThan(0);
  });

  it('can tell a served route from one that is not', async () => {
    const routes = await consoleRoutes();

    expect(servingRoute(routes, { method: 'GET', url: '/console/auth/login' })).toBe(
      '/console/auth/login',
    );
    expect(servingRoute(routes, { method: 'GET', url: '/console/api/no-such-route' })).toBe(
      undefined,
    );
    expect(servingRoute(routes, { method: 'POST', url: '/console/auth/login' })).toBe(undefined);
  });

  it('serves every console route the document sends a request to', async () => {
    const routes = await consoleRoutes();
    const missing = requestLines()
      .filter((request) => servingRoute(routes, request) === undefined)
      .map((request) => `${request.method} ${request.url}`);

    expect(missing, `${GUIDE} sends requests to console routes the server does not serve`).toEqual(
      [],
    );
  });
});
