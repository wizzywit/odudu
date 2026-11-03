import { describe, expect, it } from 'vitest';
import type { AdminCapability, Authority } from '#/shared/lib/services/principal';
import { recordOpener, tenantRecordAccess } from '#/pages/tenants/services/access';
import { tenantAdminCarries } from '#/shared/lib/services/capabilities';

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

describe('recordOpener', () => {
  it('opens a row when nothing is missing, and offers nothing when something is', () => {
    const opened: string[] = [];
    const open = (name: string): void => {
      opened.push(name);
    };
    recordOpener([], open)?.('acme');
    expect(opened).toEqual(['acme']);
    expect(recordOpener(['manage-tenant'], open)).toBeNull();
  });
});
