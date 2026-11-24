import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '#/service/return-to';

describe('safeReturnTo', () => {
  it('accepts a path under /console/', () => {
    expect(safeReturnTo('/console/tenants/acme/subjects?q=a')).toBe(
      '/console/tenants/acme/subjects?q=a',
    );
  });

  it('preserves search and hash exactly', () => {
    expect(safeReturnTo('/console/tenants/acme/subjects?q=a%20b#x')).toBe(
      '/console/tenants/acme/subjects?q=a%20b#x',
    );
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash-prefixed path', '/\\evil'],
    ['an absolute URL', 'https://evil'],
    ['a traversal out of /console/', '/console/../admin'],
    ['an encoded traversal', '/console%2F..%2Fadmin'],
    ['an encoded protocol-relative URL', '%2F%2Fevil'],
    ['an empty value', ''],
    ['undefined', undefined],
    ['a double-encoded traversal', '/console/%252e%252e/admin'],
    ['a double-encoded slash traversal', '/console/..%252f..%252fadmin'],
    ['a single-encoded dot-dot segment', '/console/%2e%2e/admin'],
    ['a mixed-case single-encoded dot-dot segment', '/console/.%2E/admin'],
    ['a raw tab in the path', '/console/\tfoo'],
    ['an encoded CRLF header-injection attempt', '/console/%0d%0aSet-Cookie:x'],
    ['a raw CRLF in the path', '/console/\r\nfoo'],
    ['a backslash under /console/', '/console/\\evil'],
    ['a different-origin absolute URL under /console/', 'http://console.invalid/console/x'],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/console/');
  });
});

describe('safeReturnTo for an approval page', () => {
  const ID = '7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';

  it('accepts the approval page of a tenant, which is where a mailed link signs a person in', () => {
    expect(safeReturnTo(`/tenants/acme/approval/${ID}`)).toBe(`/tenants/acme/approval/${ID}`);
  });

  it.each([
    ['a query', `/tenants/acme/approval/${ID}?x=1`],
    ['an id that is not one', '/tenants/acme/approval/not-an-id'],
    ['a tenant name that is not one', `/tenants/Ac%2Fme/approval/${ID}`],
    ['another page of the tenant', `/tenants/acme/protocol/openid-connect/logout`],
    ['a traversal', `/tenants/acme/approval/${ID}/../../x`],
    ['a trailing path', `/tenants/acme/approval/${ID}/x`],
  ])('refuses %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/console/');
  });
});
