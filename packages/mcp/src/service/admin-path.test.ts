import { describe, expect, it } from 'vitest';
import { expandPattern } from '#/service/admin-path';

describe('expandPattern', () => {
  it('fills the tenant and the parameters, each as one encoded segment', () => {
    expect(
      expandPattern('/admin/tenants/:tenant/clients/:id', 'acme', {
        id: '0192a0a0-0000-7000-8000-000000000000',
      }),
    ).toBe('/admin/tenants/acme/clients/0192a0a0-0000-7000-8000-000000000000');
  });

  it('encodes a value that would escape its segment', () => {
    expect(expandPattern('/admin/tenants/:tenant/clients/:id', 'a b', { id: '../x?y#z/' })).toBe(
      '/admin/tenants/a%20b/clients/..%2Fx%3Fy%23z%2F',
    );
  });

  it('refuses a parameter that names the tenant', () => {
    expect(() =>
      expandPattern('/admin/tenants/:tenant/clients/:id', 'acme', { id: 'x', tenant: 'other' }),
    ).toThrow(/tenant/u);
  });

  it('refuses a missing or an unused parameter', () => {
    expect(() => expandPattern('/admin/tenants/:tenant/clients/:id', 'acme', {})).toThrow(/id/u);
    expect(() => expandPattern('/admin/tenants/:tenant/clients', 'acme', { id: 'x' })).toThrow(
      /id/u,
    );
  });

  it('refuses a value that names a path segment rather than being one', () => {
    for (const bad of ['.', '..', '']) {
      expect(() =>
        expandPattern('/admin/tenants/:tenant/clients/:id', 'acme', { id: bad }),
      ).toThrow(/segment/u);
      expect(() => expandPattern('/admin/tenants/:tenant/clients/:id', bad, { id: 'x' })).toThrow(
        /segment/u,
      );
    }
  });
});
