import { useAuthority, usePrincipal } from '#/features/session';
import { useHeldCapabilities, useMemberships } from '#/features/subjects/repository/useAccess';
import { ownRolesOf, type OwnRoles } from '#/features/subjects/services';
import { holds } from '#/shared/services/access';
import { isOwnTenant } from '#/shared/services/principal';

export type { OwnRoles };

// Every admin capability the principal holds here, the roles that carry them
// and how, and the groups it belongs to:
// what a write elsewhere would take from the principal itself. Somebody
// signed in to another tenant is no subject of this one, so holds nothing
// here to lose; without view-users neither read is admitted, so neither is
// asked, and what may be lost is judged from whoami instead.
export function useOwnRoles(tenant: string): OwnRoles {
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const member = isOwnTenant(principal, tenant);
  const asked = member && holds(authority, 'view-users');
  const roles = useHeldCapabilities(tenant, principal.subjectId, asked);
  const groups = useMemberships(tenant, principal.subjectId, asked);
  return ownRolesOf({ member, authority, roles, groups });
}
