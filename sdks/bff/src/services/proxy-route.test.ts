import { describe, expect, it } from 'vitest';
import { routeProxy, restOfPath } from '#/services/proxy-route';
import type { Upstream } from '#/types';

const api: Upstream = {
  name: 'api',
  origin: 'https://api.example',
  pathPrefixes: ['/v1', '/files/'],
};
const read: Upstream = {
  name: 'read',
  origin: 'http://10.0.0.5:8080',
  pathPrefixes: ['/'],
  methods: ['GET'],
};

describe('restOfPath', () => {
  it('returns what follows the mount path, and nothing for another path', () => {
    expect(restOfPath('/proxy/api/v1/x', '/proxy')).toBe('/api/v1/x');
    expect(restOfPath('/proxyapi/v1', '/proxy')).toBeUndefined();
    expect(restOfPath('/proxy', '/proxy')).toBeUndefined();
    expect(restOfPath('/other/api/v1', '/proxy')).toBeUndefined();
  });
});

describe('routeProxy', () => {
  it('builds the target from the origin, the path and the query', () => {
    expect(routeProxy([api], '/api/v1/items/7', '?a=1&b=%2F', 'GET')).toEqual({
      kind: 'target',
      upstream: api,
      url: 'https://api.example/v1/items/7?a=1&b=%2F',
    });
  });

  it('matches a prefix on a segment boundary only', () => {
    const verdict = (rest: string): string => routeProxy([api], rest, '', 'GET').kind;
    expect(verdict('/api/v1')).toBe('target');
    expect(verdict('/api/v1/')).toBe('target');
    expect(verdict('/api/files/a')).toBe('target');
    expect(verdict('/api/v1x')).toBe('forbidden');
    expect(verdict('/api/v10/a')).toBe('forbidden');
    expect(verdict('/api/files')).toBe('forbidden');
    expect(verdict('/api/')).toBe('forbidden');
    expect(verdict('/api')).toBe('forbidden');
  });

  it('answers not-found for a name nobody configured, and for no upstream at all', () => {
    expect(routeProxy([api], '/nope/v1', '', 'GET').kind).toBe('not-found');
    expect(routeProxy([], '/api/v1', '', 'GET').kind).toBe('not-found');
    expect(routeProxy([api], '/', '', 'GET').kind).toBe('not-found');
    expect(routeProxy([api], '/API/v1', '', 'GET').kind).toBe('not-found');
  });

  it.each([
    ['a dot segment', '/api/v1/../admin'],
    ['a trailing dot segment', '/api/v1/..'],
    ['a single dot segment', '/api/v1/./x'],
    ['an encoded dot segment', '/api/v1/%2e%2e/admin'],
    ['an encoded dot, upper case', '/api/v1/%2E%2E/admin'],
    ['a half-encoded dot segment', '/api/v1/.%2e/admin'],
    ['an encoded slash', '/api/v1/..%2fadmin'],
    ['an encoded slash, upper case', '/api/v1%2Fadmin'],
    ['an encoded backslash', '/api/v1/a%5cb'],
    ['a backslash', '/api/v1/a\\b'],
    ['a double slash', '/api/v1//admin'],
    ['an encoded percent', '/api/v1/%252e%252e/admin'],
    ['an encoded NUL', '/api/v1/a%00'],
    ['a raw NUL', '/api/v1/a\u0000'],
    ['a newline', '/api/v1/a\nb'],
    ['a path parameter', '/api/v1;/../admin'],
    ['a malformed escape', '/api/v1/%zz'],
    ['a truncated escape', '/api/v1/%2'],
    ['a non-ASCII character', '/api/v1/é'],
    ['a space', '/api/v1/a b'],
  ])('refuses %s', (_name, rest) => {
    expect(routeProxy([api], rest, '', 'GET').kind).toBe('forbidden');
  });

  it('allows an ordinary escape, such as a space or an accent', () => {
    expect(routeProxy([api], '/api/v1/a%20b/%C3%A9', '', 'GET').kind).toBe('target');
  });

  it('keeps the query out of the path checks and out of the host', () => {
    const route = routeProxy([api], '/api/v1/x', '?next=//evil.example/..', 'GET');
    expect(route).toMatchObject({
      kind: 'target',
      url: 'https://api.example/v1/x?next=//evil.example/..',
    });
  });

  it('allows GET, POST, PUT, PATCH and DELETE by default and no other method', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(routeProxy([api], '/api/v1', '', method).kind).toBe('target');
    }
    for (const method of ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND']) {
      expect(routeProxy([api], '/api/v1', '', method)).toEqual({
        kind: 'method-not-allowed',
        allow: 'GET, POST, PUT, PATCH, DELETE',
      });
    }
  });

  it('uses the methods an upstream names instead of the default', () => {
    expect(routeProxy([read], '/read/x', '', 'GET').kind).toBe('target');
    expect(routeProxy([read], '/read/x', '', 'POST')).toEqual({
      kind: 'method-not-allowed',
      allow: 'GET',
    });
  });

  it('judges the path before the method', () => {
    expect(routeProxy([api], '/api/admin', '', 'TRACE').kind).toBe('forbidden');
  });
});
