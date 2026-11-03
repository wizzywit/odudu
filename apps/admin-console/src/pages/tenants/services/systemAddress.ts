import { recordAddress, SYSTEM_BASE } from '#/shared/lib/services/address';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';

export const TENANTS_HREF = `${SYSTEM_BASE}/tenants`;

// Beside the list rather than under it: `new` and `import` are tenant names
// too, and a record's address would otherwise shadow them.
export const NEW_TENANT_HREF = `${SYSTEM_BASE}/new-tenant`;

export const IMPORT_TENANT_HREF = `${SYSTEM_BASE}/import-tenant`;

export const SYSTEM_ADMINS_HREF = `${SYSTEM_BASE}/system-admins`;

export function systemAdminsHrefOf(tenant: string): string | null {
  return tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null;
}

export function tenantHref(name: string): string {
  return recordAddress(TENANTS_HREF, name);
}
