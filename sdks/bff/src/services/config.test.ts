import { describe, expect, it } from 'vitest';
import { checkPrefix, logoutAddressOf, resolveConfig } from '#/services/config';
import type { BffOptions, Upstream } from '#/types';

const base: BffOptions = {
  issuer: 'https://id.example/tenants/demo',
  clientId: 'web1',
  redirectUri: 'https://app.example/auth/callback',
  scope: 'openid',
};
const good: Upstream = { name: 'api', origin: 'https://api.example', pathPrefixes: ['/v1'] };
const withUpstream = (patch: Partial<Upstream>): BffOptions => ({
  ...base,
  upstreams: [{ ...good, ...patch }],
});

describe('proxy configuration', () => {
  it('applies the defaults', () => {
    const config = resolveConfig(base);
    expect(config).toMatchObject({
      proxyPath: '/proxy',
      maxBodyBytes: 10 * 1024 * 1024,
      upstreamTimeoutMs: 30_000,
      upstreams: [],
    });
  });

  it.each([
    ['a name with a slash', { name: 'a/b' }],
    ['an empty name', { name: '' }],
    ['an origin with a path', { origin: 'https://api.example/v1' }],
    ['an origin with a trailing slash', { origin: 'https://api.example/' }],
    ['an origin that is not http or https', { origin: 'ftp://api.example' }],
    ['an origin with credentials', { origin: 'https://user:pw@api.example' }],
    ['an origin that is not a URL', { origin: 'api.example' }],
    ['a prefix without a leading slash', { pathPrefixes: ['v1'] }],
    ['a prefix with a dot segment', { pathPrefixes: ['/v1/../x'] }],
    ['a prefix with an encoded slash', { pathPrefixes: ['/v1%2fx'] }],
    ['a method that is not a token', { methods: ['GET /'] }],
    ['an empty method list', { methods: [] }],
  ] satisfies [string, Partial<Upstream>][])('refuses an upstream with %s', (_name, patch) => {
    expect(() => resolveConfig(withUpstream(patch))).toThrow(TypeError);
  });

  it('refuses two upstreams with one name', () => {
    expect(() => resolveConfig({ ...base, upstreams: [good, good] })).toThrow(TypeError);
  });

  it('refuses a proxyPath that is not a path below the root', () => {
    for (const proxyPath of [
      'proxy',
      '/',
      '/proxy/',
      '//x',
      '/a/../b',
      '/pro xy',
      '/p?x',
      '/p%2fx',
      '/p;x',
      '/é',
    ]) {
      expect(() => resolveConfig({ ...base, proxyPath })).toThrow(TypeError);
    }
  });

  it('refuses limits that are not positive whole numbers', () => {
    expect(() => resolveConfig({ ...base, maxBodyBytes: 0 })).toThrow(TypeError);
    expect(() => resolveConfig({ ...base, upstreamTimeoutMs: 1.5 })).toThrow(TypeError);
  });

  it('upper-cases the methods an upstream names', () => {
    const config = resolveConfig(withUpstream({ methods: ['get', 'Post'] }));
    expect(config.upstreams[0]?.methods).toEqual(['GET', 'POST']);
  });
});

describe('checkPrefix', () => {
  it('accepts none and a clean path, and refuses anything else', () => {
    expect(checkPrefix('')).toBe('');
    expect(checkPrefix('/auth')).toBe('/auth');
    expect(checkPrefix('/a/b_c.d~e-f')).toBe('/a/b_c.d~e-f');
    for (const prefix of [
      'auth',
      '/',
      '/auth/',
      '//x',
      '/a b',
      '/a?b',
      '/a%2fb',
      '/a/../b',
      '/é',
    ]) {
      expect(() => checkPrefix(prefix)).toThrow(TypeError);
    }
  });
});

describe('logout address', () => {
  it('names the client on an https endpoint', () => {
    expect(logoutAddressOf('https://id.example/logout', 'web1', undefined, false)).toBe(
      'https://id.example/logout?client_id=web1',
    );
  });

  it('refuses an http endpoint unless insecure requests are allowed', () => {
    expect(() => logoutAddressOf('http://id.example/logout', 'web1', undefined, false)).toThrow(
      TypeError,
    );
    expect(logoutAddressOf('http://id.example/logout', 'web1', undefined, true)).toBe(
      'http://id.example/logout?client_id=web1',
    );
  });
});
