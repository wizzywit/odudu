import { describe, expect, it } from 'vitest';
import { tenantAdminCarries } from '#/shared/service/administrators.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { disableFixed, tenantRecordAccess } from '#/features/tenants/service/access.ts';

describe('the tenant record page', () => {
  const caller = (...capabilities: AdminCapability[]): Authority => ({
    capabilities,
    crossTenant: true,
  });

  it('asks nothing until whoami has answered', () => {
    expect(tenantRecordAccess(undefined, 'acme')).toEqual({
      readNeeds: [],
      addNeeds: [],
      blocked: null,
    });
  });

  it('names what reading the record and adding an administrator need and the caller lacks', () => {
    const access = tenantRecordAccess(caller('manage-tenants'), 'acme');
    expect(access.readNeeds).toEqual(['manage-tenant']);
    expect(access.addNeeds).toContain('manage-users');
    expect(access.blocked?.change).toBe('add their administrators');
    const full = tenantRecordAccess(caller(...tenantAdminCarries('acme')), 'acme');
    expect(full).toEqual({ readNeeds: [], addNeeds: [], blocked: null });
  });
});

describe('enabling and disabling a tenant', () => {
  it('fixes system as enabled, and says why', () => {
    expect(disableFixed('system')).toMatch(/^system cannot be disabled/);
    expect(disableFixed('acme')).toBeNull();
  });
});
