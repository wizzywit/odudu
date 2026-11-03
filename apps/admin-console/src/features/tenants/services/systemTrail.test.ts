import { describe, expect, it } from 'vitest';
import {
  systemAdminsTrail,
  tenantAdministratorTrail,
  tenantsTrail,
} from '#/features/tenants/services/systemTrail';

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
