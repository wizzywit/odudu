import { describe, expect, it } from 'vitest';
import { pathAddress } from '../../packages/kernel/src/index.js';
import { resolveResourceMetadata } from '../../packages/mcp/src/usecase/resource-metadata.js';
import { jsonAfter, loadPages, PROTOCOL_PAGES, UNTAGGED } from './markdown.js';

// The page shows the response for this tenant on this stack, so the document
// under test fixes the address the comparison is made against.
const TENANT = 'demo';
const BASE = 'http://localhost:3000';

const PATH_FORM = `curl -sS ${BASE}/.well-known/oauth-protected-resource/tenants/${TENANT}/mcp | jq .`;

describe('the protected resource metadata the transcript shows is the one the server produces', () => {
  it('matches the path-address response member for member', async () => {
    const document = await resolveResourceMetadata(
      { findTenant: () => Promise.resolve({ enabled: true }) },
      TENANT,
      pathAddress(BASE, TENANT),
    );
    if (document === null) throw new Error('the metadata usecase returned no document');
    const shown = jsonAfter(loadPages(PROTOCOL_PAGES), PATH_FORM, UNTAGGED);

    expect(shown, 'the transcript shows a response the server no longer produces').toEqual(
      document,
    );
  });
});
