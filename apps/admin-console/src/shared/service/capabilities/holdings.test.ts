import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLIENT_KEY,
  grantableIn,
  adminClientOfRoles,
  holdingRoleIds,
  includedBy,
  isAdminRole,
} from '#/shared/service/capabilities/holdings.ts';

describe('grantableIn', () => {
  it('offers manage-tenants in system alone', () => {
    expect(grantableIn('acme')).not.toContain('manage-tenants');
    expect(grantableIn('system')).toContain('manage-tenants');
    expect(grantableIn('acme')).toContain('view-audit');
  });
});

describe('isAdminRole', () => {
  it("is a capability or tenant-admin of the built-in admin client, not a tenant role's namesake", () => {
    expect(isAdminRole({ name: 'manage-users', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: null })).toBe(false);
    expect(isAdminRole({ name: 'billing', client_key: ADMIN_CLIENT_KEY })).toBe(false);
    expect(isAdminRole({ name: 'manage-users', client_key: 'odudu-admin-x' })).toBe(false);
  });
});

describe('includedBy', () => {
  it('says which chosen capability already carries another', () => {
    expect(includedBy('manage-keys', ['tenant-admin'])).toBe('tenant-admin');
    expect(includedBy('view-users', ['manage-users'])).toBe('manage-users');
    expect(includedBy('view-audit', ['manage-users'])).toBeNull();
    expect(includedBy('tenant-admin', ['tenant-admin'])).toBeNull();
  });
});

describe('the built-in admin client in a role list', () => {
  const roles = [
    { id: 'r1', name: 'tenant-admin', client_id: 'c-own', client_key: 'own' },
    { id: 'r2', name: 'tenant-admin', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r3', name: 'manage-keys', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r4', name: 'manage-keys', client_id: 'c-own', client_key: 'own' },
    { id: 'r5', name: 'editor', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r6', name: 'view-audit', client_id: null, client_key: null },
  ];

  it('is found through its own tenant-admin, not a tenant role of the same name', () => {
    expect(adminClientOfRoles(roles)).toBe('c-admin');
    expect(adminClientOfRoles(roles.slice(0, 1))).toBeNull();
    expect(
      adminClientOfRoles([{ name: 'tenant-admin', client_id: null, client_key: ADMIN_CLIENT_KEY }]),
    ).toBeNull();
  });

  it('names a role id for each capability it holds, and no other role', () => {
    expect([...holdingRoleIds(roles)]).toEqual([
      ['tenant-admin', 'r2'],
      ['manage-keys', 'r3'],
    ]);
  });
});
