import { areaAt, useArea, type AreaAccess } from '#/features/shell/index.ts';

export function useSubjectsArea(tenant: string): AreaAccess {
  return useArea(tenant, areaAt('subjects'));
}
