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

describe('the client PATCH description', () => {
  const description =
    ADMIN_ROUTES.find(
      (route) => route.method === 'PATCH' && route.pattern === '/admin/tenants/:tenant/clients/:id',
    )?.description ?? '';

  it('says an account kept idle is reused with its roles, not replaced by an empty one', () => {
    expect(description).toContain('reuses the account it kept, with the roles it still holds');
    expect(description).toContain('otherwise creates one with no roles');
  });
});

describe('the required-action vocabulary in route descriptions', () => {
  it('is named by the required-actions route and by no other', () => {
    const naming = ADMIN_ROUTES.filter((route) =>
      (route.description ?? '').includes('`accept-terms`'),
    ).map(({ method, pattern }) => `${method} ${pattern}`);
    expect(naming).toEqual(['PUT /admin/tenants/:tenant/subjects/:id/required-actions']);
  });
});
