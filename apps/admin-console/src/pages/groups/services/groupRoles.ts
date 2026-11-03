import { blockedByDefault, roleReachUnavailable } from '#/shared/services/capabilities';
import { type AdminCapability } from '#/shared/services/principal';
import { type Defaulting } from '#/pages/groups/services/groupReach';
import type { GroupRole } from '#/pages/groups/types/groupRoles';

export function roleUnavailable(
  role: { name: string; client_key: string | null; admin_reach: readonly string[] },
  caller: readonly AdminCapability[],
  defaulting: Defaulting,
  tenant: string,
): string | null {
  if (blockedByDefault(defaulting !== null, role.admin_reach).length > 0) {
    return defaulting === 'itself'
      ? 'Every new subject joins this group, so it may hand out no admin capability.'
      : 'Every new subject joins a group beneath this one and so receives what this one hands out, so it may hand out no admin capability.';
  }
  return roleReachUnavailable(role, caller, tenant);
}

type MappedItem = GroupRole;

export function reachOfRoles(items: readonly MappedItem[], ids: readonly string[]): string[] {
  return ids.flatMap((id) => items.find((role) => role.id === id)?.admin_reach ?? []);
}
