import type { Role } from '#/entities/role';
import type { SetRolesResponse } from '#/entities/subject';
import { beyondCaller, isAdminRole } from '#/shared/lib/services/capabilities';
import { andList, counted } from '#/shared/lib/services/format';
import type { AdminCapability } from '#/shared/lib/services/principal';

export const ROLES_LABEL = 'Roles';

export interface Split {
  // The roles this tab edits.
  roleIds: string[];
  // The admin capabilities, kept as they were by every save here.
  adminIds: string[];
}

export function splitAssigned(items: SetRolesResponse['items']): Split {
  return {
    roleIds: items.filter((role) => !isAdminRole(role)).map((role) => role.id),
    adminIds: items.filter((role) => isAdminRole(role)).map((role) => role.id),
  };
}

export function heldCapabilitiesText(items: SetRolesResponse['items']): string | null {
  const names = items.filter((role) => isAdminRole(role)).map((role) => role.name);
  return names.length === 0
    ? null
    : `It also holds ${andList(names)}, which are set on its own record and kept as they are by a save here.`;
}

// Why a role cannot be given here: an admin capability has its own place,
// and one reaching a capability the caller lacks is beyond the ceiling (ADR 0040).
export function roleUnavailable(
  role: Pick<Role, 'name' | 'client_key' | 'admin_reach'>,
  caller: readonly AdminCapability[],
): string | null {
  if (isAdminRole(role)) return 'an admin capability, set on the service account itself';
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0 ? null : `reaches ${andList(beyond)}, which you do not hold`;
}

export function assignedCount(count: number): string {
  return `${counted(count, 'role', 'roles')} assigned.`;
}

export const NO_ROLES = 'The service account holds no role other than its admin capabilities.';
