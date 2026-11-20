import { describe, expect, it } from 'vitest';
import { expandPattern, INSTANCE_PATTERNS } from '#/service/admin-path';

describe('the path of an admin call', () => {
  it('fills the tenant and the parameters, each as one encoded segment', () => {
    expect(expandPattern('/admin/tenants/:tenant/clients/:id', 'a b', { id: '../x?y#z/' })).toBe(
      '/admin/tenants/a%20b/clients/..%2Fx%3Fy%23z%2F',
    );
  });

  it('refuses a parameter that names the tenant, a missing one and an unused one', () => {
    const pattern = '/admin/tenants/:tenant/clients/:id';
    expect(() => expandPattern(pattern, 'acme', { id: 'x', tenant: 'other' })).toThrow(/tenant/u);
    expect(() => expandPattern(pattern, 'acme', {})).toThrow(/id/u);
    expect(() => expandPattern('/admin/tenants/:tenant/clients', 'acme', { id: 'x' })).toThrow(
      /id/u,
    );
  });

  it('refuses a value that is a path segment rather than a name', () => {
    for (const bad of ['.', '..', '']) {
      expect(() =>
        expandPattern('/admin/tenants/:tenant/clients/:id', 'acme', { id: bad }),
      ).toThrow(/segment/u);
    }
  });

  it('allows a route with no tenant only for the two that span them', () => {
    expect(INSTANCE_PATTERNS).toEqual(['/admin/tenants', '/admin/tenants/count']);
    for (const pattern of INSTANCE_PATTERNS)
      expect(expandPattern(pattern, 'acme', {})).toBe(pattern);
    expect(() => expandPattern('/admin/export', 'acme', {})).toThrow(/tenant/u);
  });
});
