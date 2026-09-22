import { describe, expect, it } from 'vitest';
import { fencedBlocks, jsonObjectsIn, loadDocument } from './markdown.js';

// `client_id` together with `iss` names a decoded access token payload
// wherever it appears in this document — an ID token never carries
// `client_id` (OIDC Core §2 vs. RFC 9068 §2.2), and the one other kind of
// JSON object here that carries a bare `client_id` (a dynamic client
// registration response) carries no `iss`. That is what lets this check
// find every access token payload without hand-listing line numbers, and
// catch the next one a future edit adds without a `grant_id`.
describe('every decoded access token payload in docs/request-paths.md carries grant_id', () => {
  it('carries grant_id wherever it carries client_id and iss together', () => {
    const document = loadDocument('docs/request-paths.md');
    const payloads = fencedBlocks(document)
      .filter((block) => block.language === 'json')
      .flatMap((block) =>
        jsonObjectsIn(block.body).map((object) => ({ object, startLine: block.startLine })),
      )
      .filter(({ object }) => 'client_id' in object && 'iss' in object);

    if (payloads.length === 0) {
      throw new Error(
        'docs/request-paths.md no longer shows a decoded access token payload — ' +
          'no JSON object in it carries client_id. It moved, or the transcript ' +
          'this check reads was replaced with something else.',
      );
    }

    for (const { object, startLine } of payloads) {
      expect(
        object,
        `docs/request-paths.md:${String(startLine)} decodes an access token with no grant_id`,
      ).toHaveProperty('grant_id');
    }
  });
});
