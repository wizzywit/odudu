import type { Crumb } from '#/shared/service/breadcrumb.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export function systemAdminsHrefOf(tenant: string): string | null {
  return tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null;
}

const SYSTEM_BASE = '/console/system';

export const TENANTS_HREF = `${SYSTEM_BASE}/tenants`;

// Beside the list rather than under it: `new` and `import` are tenant names
// too, and a record's address would otherwise shadow them.
export const NEW_TENANT_HREF = `${SYSTEM_BASE}/new-tenant`;

export const IMPORT_TENANT_HREF = `${SYSTEM_BASE}/import-tenant`;

export const SYSTEM_ADMINS_HREF = `${SYSTEM_BASE}/system-admins`;

export const NEW_SYSTEM_ADMIN_HREF = `${SYSTEM_ADMINS_HREF}/new`;

// system's administrators are its system administrators, so their guided
// step sits under that area and the rail keeps the operator's place.
export function administratorStepHref(tenant: string): string {
  return tenant === SYSTEM_TENANT
    ? NEW_SYSTEM_ADMIN_HREF
    : `${tenantHref(tenant)}/new-administrator`;
}

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

// A created or imported tenant has no administrator yet, so this is its first.
export function administratorTitle(
  name: string,
  origin: 'created' | 'imported' | 'existing',
): string {
  return origin === 'existing'
    ? `Add an administrator to ${name}`
    : `First administrator of ${name}`;
}

export function systemAdminsTrail(current: string): readonly Crumb[] {
  return [
    { label: 'System' },
    { label: 'System administrators', href: SYSTEM_ADMINS_HREF },
    { label: current },
  ];
}

export function tenantHref(name: string): string {
  return `${TENANTS_HREF}/${encodeURIComponent(name)}`;
}

export function enterHref(name: string): string {
  return `/console/${encodeURIComponent(name)}`;
}
