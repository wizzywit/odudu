import type { AdminCapability } from '#/shared/services/principal';
import { areaHref } from '#/entities/area/services/areaHref';
import { areaAt } from '#/entities/area/services/areas';

// What an area is called, needs and is addressed by, under one tenant; a page
// that links to areas it does not own reads this.
export interface Place {
  label: string;
  capability: AdminCapability | null;
  href: string;
}

export function placeOf(tenant: string, path: string): Place {
  const area = areaAt(path);
  return { label: area.label, capability: area.capability, href: areaHref(tenant, area) };
}
