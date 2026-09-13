import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type TokenErrorCode } from '../../packages/protocol-oidc/src/service/errors.js';
import { loadDocument, REPO_ROOT, type Document } from './markdown.js';

const GUIDE = 'docs/request-paths.md';

// How many codes each document named when this check was written — a floor,
// not a count to keep current.
const DOCUMENTS: readonly (readonly [name: string, atLeast: number])[] = [
  [GUIDE, 9],
  ['README.md', 0],
];

// The error codes RFC 6749 §4.1.2.1 and §5.2, RFC 6750 §3.1 and OIDC Core
// §3.1.2.6 define. A backticked word is only read as an error code if it is
// one of these, so ordinary prose cannot be mistaken for a claim about the
// wire.
const VOCABULARY = new Set([
  'access_denied',
  'account_selection_required',
  'consent_required',
  'insufficient_scope',
  'interaction_required',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'invalid_scope',
  'invalid_token',
  'login_required',
  'registration_not_supported',
  'request_not_supported',
  'request_uri_not_supported',
  'server_error',
  'temporarily_unavailable',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
]);

// Adding a member to TokenErrorCode without listing it here, or removing one
// that is listed, fails `pnpm typecheck` — so the /token vocabulary this file
// checks the documents against cannot quietly fall behind the union.
const TOKEN_ERROR_CODES: Record<TokenErrorCode, true> = {
  invalid_client: true,
  invalid_grant: true,
  invalid_request: true,
  invalid_scope: true,
  unauthorized_client: true,
  unsupported_grant_type: true,
};

// README.md is an overview and names no error codes today, so `atLeast` is
// what says which document a silent extractor would be a bug in.
function namedIn(document: Document, atLeast: number): Set<string> {
  const codes = new Set<string>();
  for (const line of document.lines) {
    for (const match of line.matchAll(/`([a-z]+(?:_[a-z]+)+)`/gu)) {
      if (VOCABULARY.has(match[1] ?? '')) codes.add(match[1] ?? '');
    }
    // A refusal quoted as a response body or a WWW-Authenticate challenge is
    // a claim about the wire whatever the word is, so no vocabulary gate.
    for (const match of line.matchAll(/"error":\s*"([a-z_]+)"|error="([a-z_]+)"/gu)) {
      codes.add(match[1] ?? match[2] ?? '');
    }
  }
  if (codes.size < atLeast) {
    throw new Error(
      `${document.name} names ${String(codes.size)} error codes; at least ` +
        `${String(atLeast)} were there when this check was written, so either the ` +
        `refusals moved out of the document or this extractor stopped seeing them`,
    );
  }
  return codes;
}

// Comments are stripped first: a code named only in a comment explaining why
// the server stopped emitting it would otherwise keep this check green.
function serverSource(): string {
  const files = [
    ...globSync('packages/protocol-oidc/src/**/*.ts', { cwd: REPO_ROOT }),
    ...globSync('apps/server/src/**/*.ts', { cwd: REPO_ROOT }),
  ].filter((file) => !file.includes('.test.'));

  if (files.length === 0) throw new Error('found no server source to scan for error codes');

  return files
    .map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'))
    .join('\n')
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    .replaceAll(/\/\/.*$/gmu, '');
}

describe('the error codes the documents name are ones the server can emit', () => {
  const source = serverSource();

  for (const [name, atLeast] of DOCUMENTS) {
    it(`every error code in ${name} appears in the server's own source`, () => {
      const absent = [...namedIn(loadDocument(name), atLeast)].filter(
        (code) => !source.includes(`'${code}'`) && !source.includes(`"${code}"`),
      );

      expect(
        absent.sort(),
        `${name} documents refusals this server has no code left to produce`,
      ).toEqual([]);
    });
  }

  it(`${GUIDE} names every refusal /token can answer with`, () => {
    const named = namedIn(loadDocument(GUIDE), 9);
    const undocumented = Object.keys(TOKEN_ERROR_CODES).filter((code) => !named.has(code));

    expect(
      undocumented,
      `these /token refusals are reachable but described nowhere in ${GUIDE}`,
    ).toEqual([]);
  });
});
