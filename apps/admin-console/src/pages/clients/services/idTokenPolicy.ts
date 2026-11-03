import { DEFAULT_MAX_AGE_MAX, ID_TOKEN_SIGNING_ALGS } from '@odudu/contracts/admin';
import { AUTO } from '#/pages/clients/services/choices';
import { formatDuration } from '#/shared/lib/services/format';
import type { Choice } from '#/shared/lib/services/choice';

export const FULL_SCOPE_LABEL = 'Include all roles in tokens';
export const FULL_SCOPE_RULE =
  "On: the roles scope carries all of a person's roles. Off: only roles mapped to the granted scopes.";

export function idTokenAlgOptions(): Choice[] {
  return [
    { id: AUTO, label: "The tenant's active signing key" },
    ...ID_TOKEN_SIGNING_ALGS.map((id) => ({ id, label: id })),
  ];
}

export const ID_TOKEN_ALG_RULE =
  'The algorithm the ID token is signed with. The tenant must hold an active key of it, which the server checks when this is saved.';

export const MAX_AGE_LABEL = 'Default maximum authentication age';
export const MAX_AGE_START = 3600;
export const MAX_AGE_OFF = 'Only when a request asks for one';
export const MAX_AGE_RULE = `A person whose sign-in is older than this signs in again, when a request names no max_age of its own. From 0 s, which asks every time, to ${formatDuration(DEFAULT_MAX_AGE_MAX)}.`;
export const MAX_AGE_MAX = DEFAULT_MAX_AGE_MAX;

export const AUTH_TIME_LABEL = 'Include auth_time';
export const AUTH_TIME_RULE =
  'Every ID token states when the person last signed in, whether or not the request asked for it.';

export function maxAgeText(value: unknown): string {
  return typeof value === 'number' ? formatDuration(value) : MAX_AGE_OFF.toLowerCase();
}

export const ID_TOKEN_ALG_LABEL = 'ID token signing algorithm';
export const REQUIRE_AUTH_TIME_NOTE = 'Off, auth_time is included only when a request asks for it.';
