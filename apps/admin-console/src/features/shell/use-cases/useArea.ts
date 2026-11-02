import { useAuthority, useAuthorityAnswered, usePrincipal } from '#/features/session';
import { type Area } from '#/features/shell/services/areas';
import { areaAccess, type AreaAccess } from '#/features/shell/services/pending';

export function useArea(tenant: string, area: Area): AreaAccess {
  return areaAccess(
    usePrincipal(),
    tenant,
    useAuthority(tenant),
    area,
    useAuthorityAnswered(tenant),
  );
}
