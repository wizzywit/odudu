import { describe, expect, it } from 'vitest';
import { isRegisteredRedirectUri } from '#/service/redirect-uri';

const REGISTERED = ['https://app.example/callback'];

describe('[OIDC-CORE-3.1.2.1-06] isRegisteredRedirectUri', () => {
  it('matches the exact registered string', () => {
    expect(
      isRegisteredRedirectUri('https://app.example/callback', REGISTERED, 'confidential'),
    ).toBe(true);
  });

  it('rejects a trailing slash the client added', () => {
    expect(
      isRegisteredRedirectUri('https://app.example/callback/', REGISTERED, 'confidential'),
    ).toBe(false);
  });

  it('rejects a path-case change', () => {
    expect(
      isRegisteredRedirectUri('https://app.example/Callback', REGISTERED, 'confidential'),
    ).toBe(false);
  });

  it('rejects an extra query parameter', () => {
    expect(
      isRegisteredRedirectUri('https://app.example/callback?x=1', REGISTERED, 'confidential'),
    ).toBe(false);
  });

  it('rejects a URI absent from the registered list entirely', () => {
    expect(isRegisteredRedirectUri('https://evil.example/cb', REGISTERED, 'confidential')).toBe(
      false,
    );
  });

  // OAuth 2.1 removed wildcard matching, so a registration that looks like a
  // pattern is a literal string and matches only itself. Nothing here treats
  // `*` as standing for anything.
  it.each([
    'https://app.example/anything',
    'https://app.example/*',
    'https://other.example/callback',
  ])('does not let a registered wildcard match %s', (presented) => {
    expect(isRegisteredRedirectUri(presented, ['https://*.example/*'], 'confidential')).toBe(false);
  });

  it.each([
    'https://app.example.evil.test/callback',
    'https://evil.test/?u=https://app.example/callback',
    'https://app.example:443/callback',
    'https://App.Example/callback',
    'http://app.example/callback',
    'https://app.example/callback/../callback',
  ])('rejects %s, which only a normalizing comparison would accept', (presented) => {
    expect(isRegisteredRedirectUri(presented, REGISTERED, 'confidential')).toBe(false);
  });

  it('matches a registration that is itself a literal wildcard string', () => {
    expect(
      isRegisteredRedirectUri('https://app.example/*', ['https://app.example/*'], 'public'),
    ).toBe(true);
  });
});

// RFC 8252 §7.3: a native app listens on an ephemeral loopback port, so an
// authorization server MUST allow any port for a loopback IP literal
// registered without one. Only a public client is eligible, and only the
// literals, never a name that resolves.
describe('isRegisteredRedirectUri, loopback port', () => {
  const V4 = ['http://127.0.0.1'];
  const V6 = ['http://[::1]'];

  it.each([
    ['http://127.0.0.1:54321/', V4],
    ['http://127.0.0.1:1/', V4],
    ['http://127.0.0.1:65535', V4],
    ['http://127.0.0.1/', V4],
    ['http://[::1]:8123/', V6],
  ])('lets a public client present %s against %j', (presented, registered) => {
    expect(isRegisteredRedirectUri(presented, registered, 'public')).toBe(true);
  });

  it('still matches the registered string exactly', () => {
    expect(isRegisteredRedirectUri('http://127.0.0.1', V4, 'public')).toBe(true);
  });

  it('matches the path of a registration that carries one, at any port', () => {
    const registered = ['http://127.0.0.1/callback'];
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/callback', registered, 'public')).toBe(
      true,
    );
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/other', registered, 'public')).toBe(
      false,
    );
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/callback/', registered, 'public')).toBe(
      false,
    );
  });

  it('keeps the query exact', () => {
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/?x=1', V4, 'public')).toBe(false);
  });

  it.each([
    'http://127.0.0.1.evil.test:9000/',
    'http://localhost:9000/',
    'http://127.0.0.2:9000/',
    'http://[::1]:9000/',
    'http://127.0.0.1@evil.test:9000/',
    'http://user@127.0.0.1:9000/',
    'https://127.0.0.1:9000/',
    'http://127.0.0.1:0/',
    'http://127.0.0.1:99999/',
    'http://127.0.0.1:9000/#frag',
    'http://127.0.0.1:9000\\@evil.test/',
    'http://127.0.0.1:90\t00/',
    'http://127.0.0.1:9000 /',
  ])('refuses %s against a registered 127.0.0.1', (presented) => {
    expect(isRegisteredRedirectUri(presented, V4, 'public')).toBe(false);
  });

  it('is not available to a confidential client', () => {
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/', V4, 'confidential')).toBe(false);
  });

  it('never applies to localhost or another host registered without a port', () => {
    expect(isRegisteredRedirectUri('http://localhost:9000/', ['http://localhost'], 'public')).toBe(
      false,
    );
    expect(
      isRegisteredRedirectUri('https://app.example:9000/', ['https://app.example'], 'public'),
    ).toBe(false);
  });

  it('does not widen a registration that names a port', () => {
    expect(
      isRegisteredRedirectUri('http://127.0.0.1:9001/', ['http://127.0.0.1:9000/'], 'public'),
    ).toBe(false);
    expect(
      isRegisteredRedirectUri('http://127.0.0.1:9000/', ['http://127.0.0.1:9000/'], 'public'),
    ).toBe(true);
  });

  it('does not treat the ::1 registration as covering 127.0.0.1', () => {
    expect(isRegisteredRedirectUri('http://127.0.0.1:9000/', V6, 'public')).toBe(false);
  });
});
