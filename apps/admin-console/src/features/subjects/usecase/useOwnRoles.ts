import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session';
import { useEffectiveRoles, useMemberships } from '#/features/subjects/repository/useAccess.ts';
import { holds } from '#/shared/service/access.ts';

// Every role the principal holds here and how, and the groups it belongs to:
// what a write elsewhere would take from the principal itself. Somebody
// signed in to another tenant is no subject of this one, so holds nothing
// here to lose; without view-users neither read is admitted, so neither is
// asked, and what may be lost is judged from whoami instead.
export type OwnRoles =
  | { status: 'loading' }
  | {
      status: 'ready';
      roles: readonly EffectiveRoleAssignment[];
      // The paths of the groups it belongs to directly.
      groups: readonly string[];
    }
  | { status: 'unknown' };

export function useOwnRoles(tenant: string): OwnRoles {
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const member = principal.tenant === tenant;
  const readable = holds(authority, 'view-users');
  const roles = useEffectiveRoles(tenant, principal.subjectId, member && readable);
  const groups = useMemberships(tenant, principal.subjectId, member && readable);
  if (!member) return { status: 'ready', roles: [], groups: [] };
  if (authority === undefined) return { status: 'loading' };
  if (!readable) return { status: 'unknown' };
  if (roles.status === 'failed' || groups.status === 'failed') return { status: 'unknown' };
  if (roles.status === 'loading' || groups.status === 'loading') return { status: 'loading' };
  return {
    status: 'ready',
    roles: roles.data.items,
    groups: groups.data.items.map((group) => group.path),
  };
}
