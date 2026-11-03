import { areaAt } from '#/entities/area';
import { useArea, type AreaAccess } from '#/widgets/shell';

// Every page here belongs to the System area: shown only to a system
// administrator signed in to `system`, whatever tenant the address names.
export function useTenantsArea(tenant: string): AreaAccess {
  return useArea(tenant, areaAt('tenants'));
}
