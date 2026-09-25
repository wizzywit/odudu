import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLIENT_ID,
  isSystemTenantName,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
} from '#/service/admin-capabilities';

describe('admin capabilities', () => {
  it('names the seven per-tenant capabilities', () => {
    expect([...TENANT_CAPABILITIES]).toEqual([
      'view-users',
      'manage-users',
      'manage-clients',
      'manage-tenant',
      'manage-keys',
      'manage-sessions',
      'view-audit',
    ]);
  });

  it('keeps the cross-tenant capability out of the per-tenant set', () => {
    expect(TENANT_CAPABILITIES).not.toContain(MANAGE_TENANTS);
    expect(TENANT_CAPABILITIES).not.toContain(TENANT_ADMIN);
  });

  it('composes manage-users onto view-users so granting one is enough', () => {
    expect(viewCounterpart('manage-users')).toBe('view-users');
  });

  it('gives a capability with no view counterpart none', () => {
    expect(viewCounterpart('manage-keys')).toBeNull();
    expect(viewCounterpart('view-audit')).toBeNull();
  });

  it('fixes the built-in client id and the system tenant name', () => {
    expect(ADMIN_CLIENT_ID).toBe('odudu-admin');
    expect(SYSTEM_TENANT_NAME).toBe('system');
  });

  it('flags only the system tenant name as reserved', () => {
    expect(isSystemTenantName('system')).toBe(true);
    expect(isSystemTenantName('acme')).toBe(false);
    expect(isSystemTenantName('System')).toBe(false);
  });
});
