import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '#/service/return-to';

describe('safeReturnTo', () => {
  it('accepts a path under /console/', () => {
    expect(safeReturnTo('/console/tenants/acme/subjects?q=a')).toBe(
      '/console/tenants/acme/subjects?q=a',
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
  ])('refuses %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/console/');
  });
});
