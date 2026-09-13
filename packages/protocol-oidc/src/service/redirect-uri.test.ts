import { describe, expect, it } from 'vitest';
import { isRegisteredRedirectUri } from '#/service/redirect-uri';

const REGISTERED = ['https://app.example/callback'];

describe('[OIDC-CORE-3.1.2.1-06] isRegisteredRedirectUri', () => {
  it('matches the exact registered string', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback', REGISTERED)).toBe(true);
  });

  it('rejects a trailing slash the client added', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback/', REGISTERED)).toBe(false);
  });

  it('rejects a path-case change', () => {
    expect(isRegisteredRedirectUri('https://app.example/Callback', REGISTERED)).toBe(false);
  });

  it('rejects an extra query parameter', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback?x=1', REGISTERED)).toBe(false);
  });

  it('rejects a URI absent from the registered list entirely', () => {
    expect(isRegisteredRedirectUri('https://evil.example/cb', REGISTERED)).toBe(false);
  });

  // OAuth 2.1 removed wildcard matching, so a registration that looks like a
  // pattern is a literal string and matches only itself. Nothing here treats
  // `*` as standing for anything.
  it.each([
    'https://app.example/anything',
    'https://app.example/*',
    'https://other.example/callback',
  ])('does not let a registered wildcard match %s', (presented) => {
    expect(isRegisteredRedirectUri(presented, ['https://*.example/*'])).toBe(false);
  });

  it.each([
    'https://app.example.evil.test/callback',
    'https://evil.test/?u=https://app.example/callback',
    'https://app.example:443/callback',
    'https://App.Example/callback',
    'http://app.example/callback',
    'https://app.example/callback/../callback',
  ])('rejects %s, which only a normalizing comparison would accept', (presented) => {
    expect(isRegisteredRedirectUri(presented, REGISTERED)).toBe(false);
  });

  it('matches a registration that is itself a literal wildcard string', () => {
    expect(isRegisteredRedirectUri('https://app.example/*', ['https://app.example/*'])).toBe(true);
  });
});
