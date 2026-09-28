import { describe, expect, it } from 'vitest';
import {
  forwardedRequestHeaders,
  passedResponseHeaders,
  rewriteLink,
  rewriteUri,
  upstreamPath,
} from '#/service/rewrite';

describe('upstreamPath', () => {
  it('drops the console prefix and keeps the query string exactly', () => {
    expect(upstreamPath('/console/api/admin/tenants/system/scopes?limit=1&b=%20x&limit=2')).toBe(
      '/admin/tenants/system/scopes?limit=1&b=%20x&limit=2',
    );
  });

  it.each([
    '/console/api/admin/../tenants/system/protocol/openid-connect/token',
    '/console/api/admin/%2e%2e/tenants/system/protocol/openid-connect/token',
    '/console/api/admin/..\\tenants/system/protocol/openid-connect/token',
    '/console/api/admin/tenants/../../health',
  ])('refuses %s, which resolves outside /admin/', (url) => {
    expect(upstreamPath(url)).toBeNull();
  });

  it('refuses a path outside the console admin prefix', () => {
    expect(upstreamPath('/console/api/session')).toBeNull();
  });
});

describe('rewriteUri', () => {
  it('moves an admin path under /console/api/', () => {
    expect(rewriteUri('/admin/tenants/system/scopes?cursor=a')).toBe(
      '/console/api/admin/tenants/system/scopes?cursor=a',
    );
  });

  it.each([
    'https://elsewhere.example/admin/x',
    '/tenants/system/admin/x',
    'admin/x',
    '/administrator',
  ])('leaves %s untouched', (uri) => {
    expect(rewriteUri(uri)).toBe(uri);
  });
});

describe('rewriteLink', () => {
  it('rewrites each admin URI in a Link and leaves the others', () => {
    expect(
      rewriteLink(
        '</admin/tenants/system/scopes?cursor=a>; rel="next", <https://elsewhere.example/admin/x>; rel="help"',
      ),
    ).toBe(
      '</console/api/admin/tenants/system/scopes?cursor=a>; rel="next", <https://elsewhere.example/admin/x>; rel="help"',
    );
  });
});

describe('forwardedRequestHeaders', () => {
  it('keeps only content-type, if-match, if-none-match and accept', () => {
    expect(
      forwardedRequestHeaders({
        'content-type': 'application/vnd.odudu.tenant+json',
        'if-match': '"a"',
        'if-none-match': '"b"',
        accept: 'application/json',
        authorization: 'Bearer from-the-browser',
        cookie: 'odudu-console=x',
        host: 'evil.example',
        origin: 'http://console.example.test',
        'x-odudu-console': '1',
        'x-forwarded-for': '198.51.100.1',
      }),
    ).toEqual({
      'content-type': 'application/vnd.odudu.tenant+json',
      'if-match': '"a"',
      'if-none-match': '"b"',
      accept: 'application/json',
    });
  });

  it('omits a header the browser did not send', () => {
    expect(forwardedRequestHeaders({ accept: undefined })).toEqual({});
  });
});

describe('passedResponseHeaders', () => {
  it('keeps only the five named headers, rewriting location and link', () => {
    expect(
      passedResponseHeaders({
        'content-type': 'application/problem+json',
        etag: '"e1"',
        location: '/admin/tenants/system/scopes/1',
        link: '</admin/tenants/system/scopes?cursor=a>; rel="next"',
        'cache-control': 'no-store',
        'set-cookie': ['a=1', 'b=2'],
        'content-length': 12,
        'x-request-id': 'r',
      }),
    ).toEqual({
      'content-type': 'application/problem+json',
      etag: '"e1"',
      location: '/console/api/admin/tenants/system/scopes/1',
      link: '</console/api/admin/tenants/system/scopes?cursor=a>; rel="next"',
      'cache-control': 'no-store',
    });
  });

  it('rewrites every Link header of several', () => {
    expect(passedResponseHeaders({ link: ['</admin/a>; rel="next"', '</x>; rel="help"'] })).toEqual(
      { link: ['</console/api/admin/a>; rel="next"', '</x>; rel="help"'] },
    );
  });
});
