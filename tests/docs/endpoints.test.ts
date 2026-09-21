import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { createLogger } from '../../apps/server/src/logger.js';
import { type DatabaseHandle } from '../../packages/db/src/index.js';
import { loadConfig } from '../../packages/kernel/src/index.js';
import { backticked, loadDocument, tableWithHeadings } from './markdown.js';

const DOCUMENT = 'docs/request-paths.md';

// Nothing here reaches the database: the app is built only so Fastify's own
// router can be asked what it serves.
const database: DatabaseHandle = {
  db: {} as DatabaseHandle['db'],
  sql: (() => Promise.resolve([])) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

// Fastify derives HEAD from every GET route. The documents describe requests a
// client makes, so HEAD is left out of them and out of the comparison.
const IMPLIED_BY_GET = 'HEAD';

// `@fastify/cors` registers this catch-all preflight responder itself
// (`packages/protocol-oidc/src/view/routes/cors.ts`) — plumbing for every
// route CORS applies to, not a protocol endpoint a client is told to call.
const CORS_PREFLIGHT_CATCHALL = 'OPTIONS *';

interface Endpoint {
  readonly method: string;
  readonly url: string;
}

function format(endpoint: Endpoint): string {
  return `${endpoint.method} ${endpoint.url}`;
}

// `onRoute` fires once per registered route with its real, full URL — unlike
// `printRoutes`, which renders a tree for people and folds a route nested
// under a sibling's prefix (`/token/introspect` under `/token`) down to just
// its own suffix, silently dropping routes from any comparison built on that
// text.
async function servingApp() {
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
  });
  const routes: Endpoint[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === IMPLIED_BY_GET) continue;
      routes.push({ method, url: route.url });
    }
  });
  await app.ready();
  if (routes.length === 0) {
    throw new Error("no routes reached the onRoute hook — Fastify's route API may have changed");
  }
  return { app, routes };
}

// `{realm}` reads as a placeholder to a person; Fastify spells it `:realm`.
function documented(): Endpoint[] {
  const table = tableWithHeadings(loadDocument(DOCUMENT), ['Method', 'Path', 'What it is']);
  return table.rows.flatMap((row) => {
    const [methodCell = '', pathCell = ''] = row;
    const method = backticked(methodCell)[0];
    if (method === undefined) return [];
    return backticked(pathCell).map((url) => ({ method, url: url.replace('{realm}', ':realm') }));
  });
}

describe(`the endpoints ${DOCUMENT} lists are the endpoints the server serves`, () => {
  it('serves every endpoint the document tells a reader to call', async () => {
    const { app } = await servingApp();
    const missing = documented().filter(
      (endpoint) => !app.hasRoute({ method: endpoint.method, url: endpoint.url }),
    );

    expect(
      missing.map(format),
      `${DOCUMENT} documents endpoints this server does not serve`,
    ).toEqual([]);
  });

  it('documents every endpoint the server serves', async () => {
    const { routes } = await servingApp();
    const claimed = new Set(documented().map(format));
    const undocumented = routes
      .map(format)
      .filter((endpoint) => endpoint !== CORS_PREFLIGHT_CATCHALL && !claimed.has(endpoint));

    expect(
      undocumented,
      `these endpoints are served but absent from ${DOCUMENT}'s endpoint table`,
    ).toEqual([]);
  });
});
