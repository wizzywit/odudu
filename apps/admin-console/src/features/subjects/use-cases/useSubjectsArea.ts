import { areaAt, useArea, type AreaAccess } from '#/features/shell';

export function useSubjectsArea(tenant: string): AreaAccess {
  return useArea(tenant, areaAt('subjects'));
}
