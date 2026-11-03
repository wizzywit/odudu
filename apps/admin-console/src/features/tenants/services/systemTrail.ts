import type { Crumb } from '#/shared/services/breadcrumb';
import {
  SYSTEM_ADMINS_HREF,
  TENANTS_HREF,
  tenantHref,
} from '#/features/tenants/services/systemAddress';

// The rail group, then the list, then the page: the group is a heading, not
// a page, so it has no address.
export function tenantsTrail(current: string): readonly Crumb[] {
  return [{ label: 'System' }, { label: 'Tenants', href: TENANTS_HREF }, { label: current }];
}

// A tenant's own administrator step sits under its record.
export function tenantAdministratorTrail(name: string): readonly Crumb[] {
  return [
    { label: 'System' },
    { label: 'Tenants', href: TENANTS_HREF },
    { label: name, href: tenantHref(name) },
    { label: 'Add an administrator' },
  ];
}

export function systemAdminsTrail(current: string): readonly Crumb[] {
  return [
    { label: 'System' },
    { label: 'System administrators', href: SYSTEM_ADMINS_HREF },
    { label: current },
  ];
}
