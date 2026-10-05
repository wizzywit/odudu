import { describe, expect, it } from 'vitest';
import {
  enterHref,
  IMPORT_TENANT_HREF,
  NEW_TENANT_HREF,
  tenantHref,
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
  administratorStepHref,
  administratorTitle,
  systemAdminsHrefOf,
} from '#/features/tenants/service/address.ts';

describe('the addresses', () => {
  it('puts creation and import beside the list, so no tenant name shadows them', () => {
    expect(tenantHref('new')).toBe('/console/system/tenants/new');
    expect(NEW_TENANT_HREF).toBe('/console/system/new-tenant');
    expect(IMPORT_TENANT_HREF).toBe('/console/system/import-tenant');
    expect(enterHref('acme')).toBe('/console/acme');
  });
});

describe('the way back to a list', () => {
  it('climbs from a page under Tenants through the System group', () => {
    expect(tenantsTrail('acme')).toEqual([
      { label: 'System' },
      { label: 'Tenants', href: '/console/system/tenants' },
      { label: 'acme' },
    ]);
  });

  it("climbs from a tenant's own administrator step through its record", () => {
    expect(tenantAdministratorTrail('acme')).toEqual([
      { label: 'System' },
      { label: 'Tenants', href: '/console/system/tenants' },
      { label: 'acme', href: '/console/system/tenants/acme' },
      { label: 'Add an administrator' },
    ]);
  });

  it('climbs from a page under System administrators', () => {
    expect(systemAdminsTrail('Add a system administrator')).toEqual([
      { label: 'System' },
      { label: 'System administrators', href: '/console/system/system-admins' },
      { label: 'Add a system administrator' },
    ]);
  });
});

describe('the three guided flows', () => {
  it('titles a first administrator apart from another one', () => {
    expect(administratorTitle('acme', 'created')).toBe('First administrator of acme');
    expect(administratorTitle('acme', 'imported')).toBe('First administrator of acme');
    expect(administratorTitle('acme', 'existing')).toBe('Add an administrator to acme');
  });

  it("puts each tenant's administrator step under its record", () => {
    expect(administratorStepHref('acme')).toBe('/console/system/tenants/acme/new-administrator');
    expect(administratorStepHref('system')).toBe('/console/system/system-admins/new');
  });
});

describe('the guided administrator step', () => {
  it('names where the system administrators are managed, for system alone', () => {
    expect(systemAdminsHrefOf('system')).toBe('/console/system/system-admins');
    expect(systemAdminsHrefOf('acme')).toBeNull();
  });
});
