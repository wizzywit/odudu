import { useAuthority, usePrincipal } from '#/features/session';
import { areaAccess, type Area, type AreaAccess } from '#/features/shell/service.ts';

export function useArea(tenant: string, area: Area): AreaAccess {
  return areaAccess(usePrincipal(), tenant, useAuthority(tenant), area);
}
