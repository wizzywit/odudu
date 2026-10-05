import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session/index.ts';
import { useEffectiveRoles } from '#/features/subjects/repository/useAccess.ts';
import { holds } from '#/shared/service/access.ts';

// Every role the principal holds here, and how: what a write elsewhere would
// take from the principal itself. Somebody signed in to another tenant is no
// subject of this one, so holds nothing here to lose; without view-users the
// read would be refused, so it is not asked.
export type OwnRoles =
  | { status: 'loading' }
  | { status: 'ready'; roles: readonly EffectiveRoleAssignment[] }
  | { status: 'unknown' };

export function useOwnRoles(tenant: string): OwnRoles {
  const principal = usePrincipal();
  const authority = useAuthority(tenant);
  const member = principal.tenant === tenant;
  const readable = holds(authority, 'view-users');
  const read = useEffectiveRoles(tenant, principal.subjectId, member && readable);
  if (!member) return { status: 'ready', roles: [] };
  if (authority === undefined) return { status: 'loading' };
  if (!readable) return { status: 'unknown' };
  switch (read.status) {
    case 'loading':
      return { status: 'loading' };
    case 'ready':
      return { status: 'ready', roles: read.data.items };
    case 'failed':
      return { status: 'unknown' };
  }
}
