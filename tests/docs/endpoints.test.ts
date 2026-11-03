import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_DOCS,
  NOT_LISTED,
  type ServedEndpoint,
} from '../../apps/server/src/endpoint-docs.js';
import { servingApp } from '../../apps/server/src/testing/served-routes.js';
import {
  ADMIN_PAGES,
  backticked,
  loadSource,
  PROTOCOL_PAGES,
  tableWithHeadings,
} from './markdown.js';

// Two documents, one endpoint table shape: the protocol pages are the
// protocol surface, the admin API pages the admin API. An endpoint
// documented in either satisfies this check — see the admin API pages'
// header for why they are separate documents.
const DOCUMENTS = [PROTOCOL_PAGES, ADMIN_PAGES] as const;

function format(endpoint: ServedEndpoint): string {
  return `${endpoint.method} ${endpoint.url}`;
}

// `{tenant}` reads as a placeholder to a person; Fastify spells it `:tenant`.
function documentedIn(path: string): ServedEndpoint[] {
  const table = tableWithHeadings(loadSource(path), ['Method', 'Path', 'What it is']);
  return table.rows.flatMap((row) => {
    const [methodCell = '', pathCell = ''] = row;
    const method = backticked(methodCell)[0];
    if (method === undefined) return [];
    return backticked(pathCell).map((url) => ({ method, url: url.replace('{tenant}', ':tenant') }));
  });
}

describe('the endpoints the protocol pages and the admin API pages list are the endpoints the server serves', () => {
  it('serves every endpoint each document tells a reader to call', async () => {
    const { app } = await servingApp();

    for (const document of DOCUMENTS) {
      const missing = documentedIn(document).filter(
        (endpoint) => !app.hasRoute({ method: endpoint.method, url: endpoint.url }),
      );

      expect(
        missing.map(format),
        `${document} documents endpoints this server does not serve`,
      ).toEqual([]);
    }
  }, 60_000);

  // The console gateway and the stylesheet are described by the generated
  // endpoint reference, whose own test holds it to the server.
  it('documents every endpoint the server serves, in one of the two or in the endpoint reference', async () => {
    const { endpoints } = await servingApp();
    const claimed = new Set([
      ...DOCUMENTS.flatMap((document) => documentedIn(document).map(format)),
      ...Object.keys(ENDPOINT_DOCS),
      ...NOT_LISTED,
    ]);
    const undocumented = endpoints.map(format).filter((endpoint) => !claimed.has(endpoint));

    expect(
      undocumented,
      `these endpoints are served but absent from ${DOCUMENTS.join(', ')} and ENDPOINT_DOCS`,
    ).toEqual([]);
  }, 60_000);
});
