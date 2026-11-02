import { tenantPage } from '#/shared/services/address';
import { type Area } from '#/entities/area/services/areas';

export function areaHref(tenant: string, area: Area): string {
  const base = tenantPage(tenant);
  return area.path === '' ? base : `${base}/${area.path}`;
}
