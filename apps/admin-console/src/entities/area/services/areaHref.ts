import { CONSOLE_ROOT, tenantPage } from '#/shared/services/address';
import { isTenantName } from '#/shared/services/principal';
import { type Area } from '#/entities/area/services/areas';

export function areaHref(tenant: string, area: Area): string {
  const base = tenantPage(tenant);
  return area.path === '' ? base : `${base}/${area.path}`;
}

// A tenant's overview, or the console's own root where no tenant is in the
// address (or the one there is no tenant's name).
export function overviewHref(tenant: string | undefined): string {
  return tenant !== undefined && isTenantName(tenant) ? tenantPage(tenant) : CONSOLE_ROOT;
}
