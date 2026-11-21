import { OduduError } from '@odudu-io/oidc';
import { describe, expect, it } from 'vitest';
import {
  checkedMode,
  loginUrl,
  proxyUrl,
  redirectOf,
  sessionStateOf,
  withBffHeader,
} from '#/services/bff';

describe('bff addresses', () => {
  it('join the base without doubling slashes', () => {
    expect(loginUrl('/bff/')).toBe('/bff/login');
    expect(proxyUrl('/bff', '/api/items')).toBe('/bff/proxy/api/items');
  });

  it('adds the header without losing the caller headers', () => {
    const headers = withBffHeader({ accept: 'text/plain' });
    expect(headers.get('x-odudu-bff')).toBe('1');
    expect(headers.get('accept')).toBe('text/plain');
  });
});

describe('what /session answers', () => {
  it('is signed in only with claims that name a subject', () => {
    expect(sessionStateOf({ authenticated: true, claims: { sub: 's' } }).status).toBe('signedIn');
    expect(sessionStateOf({ authenticated: true, claims: {} }).status).toBe('signedOut');
    expect(sessionStateOf({ authenticated: false }).status).toBe('signedOut');
    expect(sessionStateOf(null).status).toBe('signedOut');
  });

  it('reads the address a logout answers with', () => {
    expect(redirectOf({ redirectTo: 'https://i/logout' })).toBe('https://i/logout');
    expect(redirectOf({})).toBeUndefined();
  });
});

describe('a custom proxy path', () => {
  it('is where the proxy is called, in place of <baseUrl>/proxy', () => {
    expect(proxyUrl('/bff', '/api/items', '/api/x/proxy')).toBe('/api/x/proxy/api/items');
    expect(proxyUrl('/bff', 'api/items')).toBe('/bff/proxy/api/items');
  });

  it.each(['/p', '/api/x/proxy', '/a.b/c_d~e-f'])('is accepted as %s', (proxyPath) => {
    const mode = { kind: 'bff', baseUrl: '/bff', proxyPath } as const;
    expect(checkedMode(mode)).toBe(mode);
  });

  it.each([
    'proxy',
    '',
    '/',
    '//evil.example/p',
    'https://evil.example/p',
    '/a/../b',
    '/a/./b',
    '/a\\b',
    '/p/',
    '/a b',
    '/a%2fb',
  ])('is refused as %j', (proxyPath) => {
    expect(() => checkedMode({ kind: 'bff', baseUrl: '/bff', proxyPath })).toThrow(OduduError);
  });

  it('leaves a mode with none, and a browser mode, as they are', () => {
    const mode = { kind: 'bff', baseUrl: '/bff' } as const;
    expect(checkedMode(mode)).toBe(mode);
  });
});
