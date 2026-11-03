import type { Client, Role, SetRolesResponse } from '@odudu/contracts/admin';
import { lacking } from '#/shared/services/access';
import { beyondCaller, isAdminRole } from '#/shared/services/capabilities';
import { andList, counted } from '#/shared/services/format';
import type { AdminCapability, Authority } from '#/shared/services/principal';

export const SERVICE_CAPABILITY: AdminCapability = 'manage-users';

// The record the service account's own page reads, so the two stay in step.
export function serviceRolesRecord(subjectId: string): string {
  return `subjects/${subjectId}/roles`;
}

// The record the account's roles are saved on, or none for a client with no account.
export function serviceRolesRecordOf(
  client: { service_subject_id: string | null } | undefined,
): string | null {
  const subject = client?.service_subject_id ?? null;
  return subject === null ? null : serviceRolesRecord(subject);
}

export const SERVICE_RULE =
  'The roles the client holds when it signs in as itself with the client credentials grant. A token it is given carries these, mapped through the scopes it asks for.';

export const MISSING_ACCOUNT = 'This client has no service account.';
export const PUBLIC_NO_ACCOUNT = 'A public client has no service account.';
export const SIGN_IN_NO_ACCOUNT =
  "No service account. This client signs people in; it doesn't sign in as itself.";

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

export const IDLE_ACCOUNT =
  'Not in use: the client credentials grant is off. The account keeps its roles.';

// An account outlives the grant that uses it, so turning the grant off leaves it idle.
export function accountIdleNote(
  client: Pick<Client, 'service_subject_id' | 'grant_types'>,
): string | null {
  if (client.service_subject_id === null) return null;
  return client.grant_types.includes('client_credentials') ? null : IDLE_ACCOUNT;
}

// The built-in admin client signs people in whatever its type, and a public
// client has none by kind. Any other client lost its account, which nothing restores.
function noAccountNote(client: Pick<Client, 'type' | 'builtin_admin'>): string {
  if (client.builtin_admin) return SIGN_IN_NO_ACCOUNT;
  return client.type === 'public' ? PUBLIC_NO_ACCOUNT : MISSING_ACCOUNT;
}

// Whether the tab can say anything of the account: there is one, and the
// caller may read and set its roles. Until whoami answers nothing is ruled out.
export type ServiceAccess =
  { status: 'none'; note: string } | { status: 'denied' } | { status: 'ready'; subjectId: string };

export function serviceAccess(
  client: Pick<Client, 'service_subject_id' | 'type' | 'builtin_admin'>,
  authority: Authority | undefined,
): ServiceAccess {
  if (client.service_subject_id === null) return { status: 'none', note: noAccountNote(client) };
  if (lacking(authority, [SERVICE_CAPABILITY]).length > 0) return { status: 'denied' };
  return { status: 'ready', subjectId: client.service_subject_id };
}
