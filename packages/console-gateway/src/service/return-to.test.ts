import { describe, expect, it } from 'vitest';
import { approvalPageOf, safeReturnTo, signInDestination } from '#/service/return-to';

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

describe('approvalPageOf', () => {
  const ID = '7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';

  it('reads the tenant and the approval of an approval page path', () => {
    expect(approvalPageOf(`/tenants/acme/approval/${ID}`)).toEqual({ tenant: 'acme', id: ID });
  });

  it.each([
    '/console/',
    `/tenants/acme/approval/${ID}?x=1`,
    `/tenants/acme/approval/${ID}/`,
    `/tenants/ac%6de/approval/${ID}`,
    `https://evil.example/tenants/acme/approval/${ID}`,
    `//evil.example/tenants/acme/approval/${ID}`,
    `/tenants/acme/approval/${ID.toUpperCase()}x`,
  ])('is null for %s', (value) => {
    expect(approvalPageOf(value)).toBeNull();
  });
});

describe('signInDestination', () => {
  const ID = '7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';
  const path = `/tenants/acme/approval/${ID}`;

  it('keeps the same-origin path of a tenant on the base address', async () => {
    expect(await signInDestination(path, 'acme', () => Promise.resolve(null), true)).toBe(path);
  });

  it('maps the path to the canonical domain of a tenant that has one, whatever scheme the base has', async () => {
    expect(
      await signInDestination(path, 'acme', () => Promise.resolve('id.acme.example'), true),
    ).toBe(`https://id.acme.example/approval/${ID}`);
    expect(
      await signInDestination(path, 'acme', () => Promise.resolve('id.acme.example'), false),
    ).toBe(`http://id.acme.example/approval/${ID}`);
  });

  it('sends the console path through whatever the tenant has', async () => {
    expect(
      await signInDestination(
        '/console/tenants/acme',
        'acme',
        () => Promise.resolve('id.acme.example'),
        true,
      ),
    ).toBe('/console/tenants/acme');
  });

  it('refuses the approval page of another tenant than the one that signed in', async () => {
    expect(
      await signInDestination(path, 'other', () => Promise.resolve('id.other.example'), true),
    ).toBe('/console/');
    expect(await signInDestination(path, 'other', () => Promise.resolve(null), true)).toBe(
      '/console/',
    );
  });

  it('never takes an address from the request: an unsafe path ends at the console', async () => {
    expect(
      await signInDestination(
        'https://evil.example/',
        'acme',
        () => Promise.resolve('id.acme.example'),
        true,
      ),
    ).toBe('/console/');
    expect(
      await signInDestination(
        `/tenants/acme/approval/${ID}\\x`,
        'acme',
        () => Promise.resolve('id.acme.example'),
        true,
      ),
    ).toBe('/console/');
  });
});
