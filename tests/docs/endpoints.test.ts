import { describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { createLogger } from '../../apps/server/src/logger.js';
import { type DatabaseHandle } from '../../packages/db/src/index.js';
import { loadConfig } from '../../packages/kernel/src/index.js';
import { backticked, loadDocument, tableWithHeadings } from './markdown.js';

// Two documents, one endpoint table shape: `docs/request-paths.md` is the
// protocol surface, `docs/admin-paths.md` the admin API. An endpoint
// documented in either satisfies this check — see `docs/admin-paths.md`'s
// header for why they are separate documents.
const DOCUMENTS = ['docs/request-paths.md', 'docs/admin-paths.md'] as const;

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

// One tree line, e.g. "│   └── /introspect (POST)": `indent` is every
// 4-character column ahead of the branch marker (`│   ` for an ancestor
// with siblings still to print, `    ` for one that has finished), `url`
// is this node's own path segment, and `methods` the comma-joined list.
const TREE_LINE =
  /^(?<indent>(?:│ {3}| {4})*)(?:├── |└── )(?<url>\/\S*|\*) \((?<methods>[A-Z, ]+)\)$/u;

// `printRoutes` renders a tree for people: a route nested under a sibling's
// own path (`/token/introspect` under `/token`) prints as a child line
// carrying only its own suffix, `/introspect`, not the full URL. Parsing it
// with a single-line regex loses that prefix; walking the tree by indent
// depth and concatenating each node's segment onto its nearest shallower
// ancestor's reconstructs the real URL regardless of nesting.
function served(app: Awaited<ReturnType<typeof servingApp>>): Endpoint[] {
  const printed = app.printRoutes({ commonPrefix: false });
  const stack: { depth: number; path: string }[] = [];
  const endpoints: Endpoint[] = [];

  for (const line of printed.split('\n')) {
    const match = TREE_LINE.exec(line);
    if (match === null) continue;
    const depth = (match.groups?.indent ?? '').length / 4;
    while ((stack[stack.length - 1]?.depth ?? -1) >= depth) stack.pop();
    const parentPath = stack[stack.length - 1]?.path ?? '';
    const url = match.groups?.url ?? '';
    const path = url === '*' ? url : parentPath + url;
    stack.push({ depth, path });

    for (const method of (match.groups?.methods ?? '').split(', ')) {
      if (method === IMPLIED_BY_GET) continue;
      endpoints.push({ method, url: path });
    }
  }

  // printRoutes renders a tree for people, so its shape is not a contract. A
  // rendering change that stopped matching would otherwise empty this list and
  // turn the comparison below into a tautology.
  if (endpoints.length === 0) {
    throw new Error(`no routes parsed out of Fastify's route listing:\n${printed}`);
  }
  return endpoints;
}

// `{tenant}` reads as a placeholder to a person; Fastify spells it `:tenant`.
function documentedIn(path: string): Endpoint[] {
  const table = tableWithHeadings(loadDocument(path), ['Method', 'Path', 'What it is']);
  return table.rows.flatMap((row) => {
    const [methodCell = '', pathCell = ''] = row;
    const method = backticked(methodCell)[0];
    if (method === undefined) return [];
    return backticked(pathCell).map((url) => ({ method, url: url.replace('{tenant}', ':tenant') }));
  });
}

describe('the endpoints docs/request-paths.md and docs/admin-paths.md list are the endpoints the server serves', () => {
  it('serves every endpoint each document tells a reader to call', async () => {
    const app = await servingApp();

    for (const document of DOCUMENTS) {
      const missing = documentedIn(document).filter(
        (endpoint) => !app.hasRoute({ method: endpoint.method, url: endpoint.url }),
      );

      expect(
        missing.map(format),
        `${document} documents endpoints this server does not serve`,
      ).toEqual([]);
    }
  });

  it('documents every endpoint the server serves, in one of the two', async () => {
    const app = await servingApp();
    const claimed = new Set(DOCUMENTS.flatMap((document) => documentedIn(document).map(format)));
    const undocumented = served(app)
      .map(format)
      .filter((endpoint) => endpoint !== CORS_PREFLIGHT_CATCHALL && !claimed.has(endpoint));

    expect(
      undocumented,
      `these endpoints are served but absent from both ${DOCUMENTS.join(' and ')}`,
    ).toEqual([]);
  });
});
