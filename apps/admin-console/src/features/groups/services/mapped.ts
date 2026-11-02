import type { SetGroupRolesResponse } from '@odudu/contracts/admin';
import type { AdminCapability } from '#/shared/services/principal';
import { roleUnavailable } from '#/features/groups/services/blocks';

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
