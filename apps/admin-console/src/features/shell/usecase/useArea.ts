import { SYSTEM_TENANT, useAuthority, usePrincipal } from '#/features/session/index.ts';
import { holds, showsSystemArea, SYSTEM_AREAS, type Area } from '#/features/shell/service.ts';

export type AreaAccess =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'refused'; readonly capability: NonNullable<Area['capability']> }
  | { readonly kind: 'open' };

// whoami is advice: an area whose capability it says is missing explains
// what it needs instead of offering reads the server would refuse.
export function useArea(tenant: string, area: Area): AreaAccess {
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const system = SYSTEM_AREAS.areas.includes(area);
  if (system && (principal.tenant !== SYSTEM_TENANT || tenant !== SYSTEM_TENANT))
    return { kind: 'hidden' };
  if (area.capability === null) return { kind: 'open' };
  if (authority === undefined) return system ? { kind: 'checking' } : { kind: 'open' };
  if (system && !showsSystemArea(principal, tenant, authority)) return { kind: 'hidden' };
  return holds(authority, area.capability)
    ? { kind: 'open' }
    : { kind: 'refused', capability: area.capability };
}
