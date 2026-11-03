import { roleReachUnavailable } from '#/shared/services/capabilities';
import type { IndexedRole } from '#/entities/role';
import type { AdminCapability } from '#/shared/services/principal';

// A mapped role the caller could not give is one it cannot take.
export function keptRoles(
  mapped: readonly string[],
  index: ReadonlyMap<string, IndexedRole>,
  caller: readonly AdminCapability[],
  tenant: string,
): string[] {
  return mapped.filter((id) => {
    const found = index.get(id);
    return found !== undefined && roleReachUnavailable(found, caller, tenant) !== null;
  });
}

export const NO_ROLES_MAPPED =
  'No roles mapped. Unless a client includes all roles, it gets none from this scope.';

export const INCLUDE_ALL_POINTER =
  "'Include all roles in tokens' is set on each client, under Tokens.";
