import { areaAt, useArea, type AreaAccess } from '#/features/shell';

// Every page here belongs to the System area: shown only to a system
// administrator signed in to `system`, whatever tenant the address names.
export function useTenantsArea(tenant: string): AreaAccess {
  return useArea(tenant, areaAt('tenants'));
}
