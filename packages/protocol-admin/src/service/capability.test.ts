import { describe, expect, it } from 'vitest';
import { ADMIN_ROUTES, requiredCapability } from '#/service/capability';

describe('requiredCapability', () => {
  it('reads a subject list with view-users and writes with manage-users', () => {
    expect(requiredCapability('GET', '/admin/tenants/:tenant/subjects')).toBe('view-users');
    expect(requiredCapability('POST', '/admin/tenants/:tenant/subjects')).toBe('manage-users');
  });

  it('is authentication alone for whoami, and for no other route', () => {
    const nullCapabilityRoutes = ADMIN_ROUTES.filter((route) => route.capability === null);
    expect(nullCapabilityRoutes).toEqual([
      { method: 'GET', pattern: '/admin/tenants/:tenant/whoami', capability: null },
    ]);
  });

  it('returns undefined for a method/pattern pair no route declares', () => {
    expect(requiredCapability('DELETE', '/admin/tenants/:tenant/whoami')).toBeUndefined();
    expect(requiredCapability('GET', '/admin/tenants/:tenant/nonexistent')).toBeUndefined();
  });

  it('has an entry for every admin route', () => {
    // ADMIN_ROUTES is the single list the router registers from, so a route
    // added without a capability fails here rather than shipping open.
    for (const route of ADMIN_ROUTES) {
      expect(
        requiredCapability(route.method, route.pattern),
        `${route.method} ${route.pattern}`,
      ).not.toBeUndefined();
    }
  });
});
