import type { Client } from '#/entities/client';
import { notLacking } from '#/shared/lib/services/access';
import type { AdminCapability, Authority } from '#/shared/lib/services/principal';

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
  if (!notLacking(authority, [SERVICE_CAPABILITY])) return { status: 'denied' };
  return { status: 'ready', subjectId: client.service_subject_id };
}
