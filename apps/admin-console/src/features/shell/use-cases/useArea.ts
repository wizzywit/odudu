import { useAuthority, useAuthorityAnswered, usePrincipal } from '#/features/session';
import { areaAccess, type Area, type AreaAccess } from '#/features/shell/services';

export function useArea(tenant: string, area: Area): AreaAccess {
  return areaAccess(
    usePrincipal(),
    tenant,
    useAuthority(tenant),
    area,
    useAuthorityAnswered(tenant),
  );
}
