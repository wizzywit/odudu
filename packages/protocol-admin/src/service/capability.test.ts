import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES, requiredCapability } from '#/service/capability';

describe('requiredCapability', () => {
  it('reads a subject list with view-users', () => {
    expect(requiredCapability('GET', '/admin/tenants/:tenant/subjects')).toBe('view-users');
  });

  it('requires manage-tenants for the tenant collection, which carries no :tenant segment', () => {
    expect(requiredCapability('GET', '/admin/tenants')).toBe('manage-tenants');
    expect(requiredCapability('POST', '/admin/tenants')).toBe('manage-tenants');
  });

  it('is authentication alone for whoami, and for no other route', () => {
    const nullCapabilityRoutes = ADMIN_ROUTES.filter((route) => route.capability === null).map(
      ({ method, pattern, capability }) => ({ method, pattern, capability }),
    );
    expect(nullCapabilityRoutes).toEqual([
      { method: 'GET', pattern: '/admin/tenants/:tenant/whoami', capability: null },
    ]);
  });

  it('returns undefined for a method/pattern pair no route declares', () => {
    expect(requiredCapability('DELETE', '/admin/tenants/:tenant/whoami')).toBeUndefined();
    expect(requiredCapability('GET', '/admin/tenants/:tenant/nonexistent')).toBeUndefined();
    expect(requiredCapability('DELETE', '/admin/tenants/:tenant/subjects')).toBeUndefined();
  });
});
