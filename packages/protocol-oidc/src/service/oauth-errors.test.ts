import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ERRORS,
  AUTHORIZE_REQUEST_DESCRIPTIONS,
  CIBA_REQUEST_LIMIT_DESCRIPTION,
  OAUTH_ERROR_DESCRIPTIONS,
  OAUTH_ERROR_DOCS,
  REGISTRATION_ERRORS,
  surfacesOf,
  TOKEN_ERRORS,
  USERINFO_ERRORS,
  type OAuthErrorCode,
  type OAuthSurface,
} from '#/service/oauth-errors';

const SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function text(files: readonly string[]): string {
  return files.map((file) => readFileSync(path.join(SRC, file), 'utf8')).join('\n');
}

// The modules that answer each surface. The code types what they answer with
// (the lists in oauth-errors.ts), so an unlisted value does not compile; this
// is the other direction: a listed value that no module writes any more.
const MODULES: Record<OAuthSurface, readonly string[]> = {
  authorization: [
    'service/authorize-validation.ts',
    'service/query-normalization.ts',
    'usecase/authorization-request.ts',
    'usecase/login-submission.ts',
    'usecase/session-reuse.ts',
    'usecase/consent-submission.ts',
    'view/routes/expired-sign-in.ts',
  ],
  token: sources(SRC)
    .map((file) => path.relative(SRC, file))
    .filter((file) => !file.endsWith('oauth-errors.ts')),
  userinfo: ['usecase/userinfo.ts', 'view/routes/userinfo.ts'],
  registration: [
    'service/client-metadata.ts',
    'usecase/client-registration.ts',
    'view/routes/client-registration.ts',
  ],
};

const LISTS: Record<OAuthSurface, readonly OAuthErrorCode[]> = {
  authorization: AUTHORIZATION_ERRORS,
  token: TOKEN_ERRORS,
  userinfo: USERINFO_ERRORS,
  registration: REGISTRATION_ERRORS,
};

describe('the OAuth error codes', () => {
  it('describe every code of every surface and no other', () => {
    const listed = new Set<string>(Object.values(LISTS).flat());
    expect(Object.keys(OAUTH_ERROR_DOCS).sort()).toEqual([...listed].sort());
  });

  it.each(Object.keys(LISTS) as OAuthSurface[])(
    'are each still written by a module of the %s surface',
    (surface) => {
      const written = text(MODULES[surface]);
      const gone = LISTS[surface].filter((code) => !written.includes(`'${code}'`));
      expect(gone).toEqual([]);
    },
  );

  it('say where each is answered from the lists, not from a second table', () => {
    expect(surfacesOf('invalid_request')).toEqual(['authorization', 'token', 'userinfo']);
    expect(surfacesOf('invalid_grant')).toEqual(['token']);
    expect(surfacesOf('invalid_token')).toEqual(['userinfo', 'registration']);
    expect(surfacesOf('login_required')).toEqual(['authorization']);
  });

  it('give each code a one-paragraph meaning', () => {
    for (const [code, docs] of Object.entries(OAUTH_ERROR_DOCS)) {
      expect(docs.summary, code).toMatch(/^\S.*\.$/u);
      expect(docs.summary, code).not.toContain('\n');
    }
  });
});

// RFC 6749 §4.1.2.1 and §5.2 limit error_description to printable ASCII without
// a double quote or a backslash; a sentence per code, fixed, so it can never
// echo a request or tell a caller which check failed.
describe('the error_description of every code the authorization and token endpoints answer', () => {
  const codes = [...new Set([...AUTHORIZATION_ERRORS, ...TOKEN_ERRORS])];
  const sentences = [
    ...codes.map((code) => OAUTH_ERROR_DESCRIPTIONS[code]),
    ...Object.values(AUTHORIZE_REQUEST_DESCRIPTIONS),
    CIBA_REQUEST_LIMIT_DESCRIPTION,
  ];

  it.each(codes)('%s has a short sentence in the permitted characters', (code) => {
    const text = OAUTH_ERROR_DESCRIPTIONS[code];
    expect(text.length).toBeGreaterThan(10);
    expect(text.length).toBeLessThanOrEqual(80);
    expect(text).toMatch(/^[\x20\x21\x23-\x5b\x5d-\x7e]+$/u);
  });

  it('says of the request limit that it is a limit, not a refusal by the person', () => {
    expect(CIBA_REQUEST_LIMIT_DESCRIPTION).not.toBe(OAUTH_ERROR_DESCRIPTIONS.access_denied);
  });

  it('does not say which check an invalid_grant failed', () => {
    expect(OAUTH_ERROR_DESCRIPTIONS.invalid_grant).not.toMatch(/expired|used|verifier|redirect/iu);
  });

  it.each(sentences)('%s is a short sentence in the permitted characters', (text) => {
    expect(text.length).toBeGreaterThan(10);
    expect(text.length).toBeLessThanOrEqual(80);
    expect(text).toMatch(/^[\x20\x21\x23-\x5b\x5d-\x7e]+$/u);
  });
});
