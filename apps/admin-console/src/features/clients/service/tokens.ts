import {
  CLIENT_GRANT_TYPES,
  CLIENT_TOKEN_TTL_RANGES,
  DEFAULT_MAX_AGE_MAX,
  ID_TOKEN_SIGNING_ALGS,
  type Client,
  type ClientTokenTtlField,
} from '@odudu/contracts/admin';
import { AUTO } from '#/features/clients/service/choices.ts';
import { formatDuration } from '#/shared/service/format.ts';
import type { ChecklistOption } from '#/shared/view/ChecklistField';
import type { SelectOption } from '#/shared/view/Field';

export interface Lifetime {
  field: ClientTokenTtlField;
  label: string;
  // What a client with no lifetime of its own takes.
  inherits: string;
  // The value a lifetime starts from when a client is given one.
  start: number;
}

export const LIFETIME_LABELS: Readonly<Record<ClientTokenTtlField, string>> = {
  access_token_ttl_seconds: 'Access token lifetime',
  id_token_ttl_seconds: 'ID token lifetime',
  refresh_token_ttl_seconds: 'Refresh token lifetime',
};

export const LIFETIMES: readonly Lifetime[] = [
  {
    field: 'access_token_ttl_seconds',
    label: LIFETIME_LABELS.access_token_ttl_seconds,
    inherits: "Takes the tenant's access token lifetime, set under Settings.",
    start: 3600,
  },
  {
    field: 'id_token_ttl_seconds',
    label: LIFETIME_LABELS.id_token_ttl_seconds,
    inherits: "Takes the tenant's ID token lifetime, set under Settings.",
    start: 3600,
  },
  {
    field: 'refresh_token_ttl_seconds',
    label: LIFETIME_LABELS.refresh_token_ttl_seconds,
    inherits: "Takes the tenant's refresh token lifetime, set under Settings.",
    start: 86_400,
  },
];

export function lifetimeBounds(field: ClientTokenTtlField): {
  min: number;
  max: number | undefined;
} {
  const { min, max } = CLIENT_TOKEN_TTL_RANGES[field];
  return { min, max };
}

// The range the server holds the lifetime to, with its human reading.
export function lifetimeRule(field: ClientTokenTtlField): string {
  const { min, max } = lifetimeBounds(field);
  return max === undefined
    ? `At least ${formatDuration(min)}.`
    : `Between ${formatDuration(min)} and ${formatDuration(max)}.`;
}

// Each toggle says which lifetime it hands back, so three are told apart.
export function tenantLifetimeLabel(label: string): string {
  return `Use the tenant's ${label.toLowerCase()}`;
}

export const GRANT_LABELS: Readonly<Record<string, string>> = {
  authorization_code: 'Authorization code',
  refresh_token: 'Refresh token',
  client_credentials: 'Client credentials',
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Token exchange',
};

const GRANT_NOTES: Readonly<Record<string, string>> = {
  authorization_code: 'Signs a person in through the browser.',
  refresh_token: 'Renews a sign-in without the person returning.',
  client_credentials: "The client acts as itself, through its service account's roles.",
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Trades one token for another (RFC 8693).',
};

const NO_SECRET = 'A public client has no secret to authenticate with, so it cannot hold this.';

export function grantOptions(client: Pick<Client, 'type' | 'grant_types'>): ChecklistOption[] {
  return CLIENT_GRANT_TYPES.map((id) => ({
    id,
    label: GRANT_LABELS[id] ?? id,
    description: GRANT_NOTES[id] ?? '',
    unavailable:
      id === 'client_credentials' && client.type === 'public' && !client.grant_types.includes(id)
        ? NO_SECRET
        : null,
  }));
}

export const GRANTS_RULE =
  'What the client may ask the token endpoint for. A client holding none can obtain no token.';

// Every grant but client credentials alone starts from a sign-in that
// returns to a redirect URI, so a client with none holds only that one.
export function grantsBlock(grants: readonly string[], redirectUris: number): string | undefined {
  const alone = grants.length === 1 && grants[0] === 'client_credentials';
  if (alone || redirectUris > 0) return undefined;
  return 'This client has no redirect URI, so it can hold only client credentials. Add a redirect URI under Redirects & origins first.';
}

export const CREDENTIALS_RULE =
  'The scopes a client credentials token may carry, such as reports:read: the names a resource server checks, not the OpenID scopes assigned under Scopes.';

export const CREDENTIALS_NOUN = 'scope names';

export const FULL_SCOPE_RULE =
  'Off, a token carries only the roles a scope this client is assigned maps to. On, it carries every role the subject holds, whatever scope asked.';

export function idTokenAlgOptions(): SelectOption[] {
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

export const SECTIONS_TOKENS = {
  lifetimes: 'Token lifetimes',
  grants: 'Grant types',
  credentials: 'Client credentials',
  fullScope: 'Roles in tokens',
  idToken: 'ID token',
} as const;

export function lifetimeText(value: unknown): string {
  return typeof value === 'number' ? formatDuration(value) : "the tenant's lifetime";
}

export function maxAgeText(value: unknown): string {
  return typeof value === 'number' ? formatDuration(value) : MAX_AGE_OFF.toLowerCase();
}

// A number field cleared reads NaN; the lifetime then stays as it was.
export function numberKept(entered: number, was: number): number {
  return Number.isNaN(entered) ? was : entered;
}

export const ID_TOKEN_ALG_LABEL = 'ID token signing algorithm';
export const REQUIRE_AUTH_TIME_NOTE = 'Off, auth_time is included only when a request asks for it.';

export const TOKEN_FIELD = {
  credentials: 'Client credentials scopes',
  fullScope: 'Every role the subject holds',
  grants: 'Grant types',
} as const;
