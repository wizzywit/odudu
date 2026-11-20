import { describe, expect, it } from 'vitest';
import { loginUrl, proxyUrl, redirectOf, sessionStateOf, withBffHeader } from '#/services/bff';

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
