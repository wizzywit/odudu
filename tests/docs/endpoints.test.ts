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
  await app.ready();
  return app;
}

// Fastify derives HEAD from every GET route. The documents describe requests a
// client makes, so HEAD is left out of them and out of the comparison.
const IMPLIED_BY_GET = 'HEAD';

interface Endpoint {
  readonly method: string;
  readonly url: string;
}

function format(endpoint: Endpoint): string {
  return `${endpoint.method} ${endpoint.url}`;
}

function served(app: Awaited<ReturnType<typeof servingApp>>): Endpoint[] {
  const printed = app.printRoutes({ commonPrefix: false });
  const endpoints = [...printed.matchAll(/(?<url>\/\S*) \((?<methods>[A-Z, ]+)\)/gu)].flatMap(
    (match) =>
      (match.groups?.methods ?? '')
        .split(', ')
        .filter((method) => method !== IMPLIED_BY_GET)
        .map((method) => ({ method, url: match.groups?.url ?? '' })),
  );

  // printRoutes renders a tree for people, so its shape is not a contract. A
  // rendering change that stopped matching would otherwise empty this list and
  // turn the comparison below into a tautology.
  if (endpoints.length === 0) {
    throw new Error(`no routes parsed out of Fastify's route listing:\n${printed}`);
  }
  return endpoints;
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
    const app = await servingApp();
    const missing = documented().filter(
      (endpoint) => !app.hasRoute({ method: endpoint.method, url: endpoint.url }),
    );

    expect(
      missing.map(format),
      `${DOCUMENT} documents endpoints this server does not serve`,
    ).toEqual([]);
  });

  it('documents every endpoint the server serves', async () => {
    const app = await servingApp();
    const claimed = new Set(documented().map(format));
    const undocumented = served(app)
      .map(format)
      .filter((endpoint) => !claimed.has(endpoint));

    expect(
      undocumented,
      `these endpoints are served but absent from ${DOCUMENT}'s endpoint table`,
    ).toEqual([]);
  });
});
