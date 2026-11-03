import type { EffectiveRoleAssignment } from '#/shared/lib/types/capabilities';
import { holds } from '#/shared/lib/services/access';
import { type Authority } from '#/shared/lib/services/principal';
import { type Loaded } from '#/shared/lib/services/read';

export type OwnRoles =
  | { status: 'loading' }
  | {
      status: 'ready';
      roles: readonly EffectiveRoleAssignment[];
      // The paths of the groups it belongs to directly.
      groups: readonly string[];
    }
  | { status: 'unknown' };

export function ownRolesOf({
  member,
  authority,
  roles,
  groups,
}: {
  member: boolean;
  authority: Authority | undefined;
  roles: Loaded<{ items: readonly EffectiveRoleAssignment[] }>;
  groups: Loaded<{ items: readonly { path: string }[] }>;
}): OwnRoles {
  if (!member) return { status: 'ready', roles: [], groups: [] };
  if (authority === undefined) return { status: 'loading' };
  if (!holds(authority, 'view-users')) return { status: 'unknown' };
  if (roles.status === 'failed' || groups.status === 'failed') return { status: 'unknown' };
  if (roles.status === 'loading' || groups.status === 'loading') return { status: 'loading' };
  return {
    status: 'ready',
    roles: roles.data.items,
    groups: groups.data.items.map((group) => group.path),
  };
}
