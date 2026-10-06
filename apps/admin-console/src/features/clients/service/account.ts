import type { Role, SetRolesResponse } from '@odudu/contracts/admin';
import { beyondCaller, isAdminRole } from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export const SERVICE_CAPABILITY = 'manage-users';

// The record the service account's own page reads, so the two stay in step.
export function serviceRolesRecord(subjectId: string): string {
  return `subjects/${subjectId}/roles`;
}

export const SERVICE_RULE =
  'The roles the client holds when it signs in as itself with the client credentials grant. A token it is given carries these, mapped through the scopes it asks for.';

export const NO_ACCOUNT =
  'This client has no service account: only a confidential client is given one, and a public client signs nobody in as itself.';

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
  return count === 1 ? '1 role assigned.' : `${String(count)} roles assigned.`;
}

export const NO_ROLES = 'The service account holds no role other than its admin capabilities.';

interface Named {
  id: string;
  name: string;
  client_key: string | null;
}

// Every role seen, by id, whichever list showed it.
export function nameIndex(...lists: (readonly Named[])[]): ReadonlyMap<string, Named> {
  return new Map(lists.flat().map((role) => [role.id, role]));
}

export interface AssignedRole {
  id: string;
  name: string;
  // The client whose role it is, or null for a tenant role.
  client: string | null;
}

export function assignedRoles(
  ids: readonly string[],
  known: ReadonlyMap<string, Named>,
): AssignedRole[] {
  return ids
    .map((id) => {
      const role = known.get(id);
      return { id, name: role?.name ?? id, client: role?.client_key ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.client ?? '').localeCompare(b.client ?? ''));
}

export function roleNameOf(known: ReadonlyMap<string, Named>): (id: string) => string {
  return (id) => known.get(id)?.name ?? id;
}
