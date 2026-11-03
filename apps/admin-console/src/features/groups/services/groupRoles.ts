import { roleReachUnavailable } from '#/shared/services/capabilities';
import { type AdminCapability } from '#/shared/services/principal';
import { type Defaulting } from '#/features/groups/services/groupReach';
import { type SetGroupRolesResponse } from '@odudu/contracts/admin';

export function roleUnavailable(
  role: { name: string; client_key: string | null; admin_reach: readonly string[] },
  caller: readonly AdminCapability[],
  defaulting: Defaulting,
  tenant: string,
): string | null {
  if (defaulting === 'itself' && role.admin_reach.length > 0) {
    return 'Every new subject joins this group, so it may hand out no admin capability.';
  }
  if (defaulting === 'beneath' && role.admin_reach.length > 0) {
    return 'Every new subject joins a group beneath this one and so receives what this one hands out, so it may hand out no admin capability.';
  }
  return roleReachUnavailable(role, caller, tenant);
}

type MappedItem = SetGroupRolesResponse['items'][number];

// A role mapped here that the caller could not give is one it cannot take.
export function keptRoles(
  items: readonly MappedItem[],
  caller: readonly AdminCapability[],
  tenant: string,
): string[] {
  return items
    .filter((role) => roleUnavailable(role, caller, null, tenant) !== null)
    .map((role) => role.id);
}

export function reachOfRoles(items: readonly MappedItem[], ids: readonly string[]): string[] {
  return ids.flatMap((id) => items.find((role) => role.id === id)?.admin_reach ?? []);
}
