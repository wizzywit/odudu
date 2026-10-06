import type { Client } from '@odudu/contracts/admin';
import { BUILTIN_FIXED } from '#/features/clients/service/labels.ts';

export type Fixable = Pick<Client, 'builtin_admin' | 'client_id'>;

// The built-in admin client is amended through an allowlist: whether it is
// enabled, and where it redirects, could lock every administrator out.
export function enabledFixed(client: Fixable): string | null {
  return client.builtin_admin ? `${client.client_id} cannot be disabled. ${BUILTIN_FIXED}` : null;
}

export function redirectsFixed(client: Fixable): string | null {
  return client.builtin_admin
    ? `${client.client_id}'s redirect URIs and web origins cannot be changed. ${BUILTIN_FIXED}`
    : null;
}

export function deleteFixed(client: Fixable): string | null {
  return client.builtin_admin ? `${client.client_id} cannot be deleted. ${BUILTIN_FIXED}` : null;
}

// Shown as text where nothing on the client may be changed, or where these
// two lists, which decide how an administrator signs in, are fixed.
export function listsReadOnly(client: Fixable, writable: boolean): boolean {
  return !writable || redirectsFixed(client) !== null;
}
