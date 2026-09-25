import { clients } from '@odudu/domain-tenant';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { getTableColumns } from 'drizzle-orm';
import { type PgTable } from 'drizzle-orm/pg-core';

function columnNames(table: PgTable): readonly string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

// The real column lists, not a hand-kept restatement of them — a column
// added to either table shows up here without this file changing, so the
// "accounts for every column" test below (client-patch.test.ts) actually
// exercises the schema rather than a copy of it.
export const CLIENT_COLUMNS: readonly string[] = columnNames(clients);
export const CLIENT_OIDC_CONFIG_COLUMNS: readonly string[] = columnNames(clientOidcConfig);

// `client_id` and `tenant_id` name the same column on both tables — one
// reason serves both. Every reason below is why a general-purpose amend
// must never reach that field, not merely that it currently does not.
const REFUSALS: Readonly<Record<string, string>> = {
  id: 'identity: changing it breaks every relying party and orphans the azp of every issued token',
  tenant_id:
    'identity: changing it breaks every relying party and orphans the azp of every issued token',
  client_id:
    'identity: changing it breaks every relying party and orphans the azp of every issued token',
  created_at: 'created_at is history',
  registration_origin: 'registration_origin is provenance; rewriting it falsifies a record',
  service_subject_id: 'service_subject_id re-points role assignments and needs its own operation',
  secret_hash: 'secret_hash is rotated through its own endpoint',
  type: "type silently changes a live client's security model in both directions",
  builtin_admin:
    "builtin_admin marks the client a tenant's administration roles hang from; changing it needs its own operation, not a general amendment",
};

export function refusalFor(field: string): string | null {
  return REFUSALS[field] ?? null;
}

const ALL_FIELDS = [...new Set([...CLIENT_COLUMNS, ...CLIENT_OIDC_CONFIG_COLUMNS])];

export const AMENDABLE_CLIENT_FIELDS: readonly string[] = ALL_FIELDS.filter(
  (field) => refusalFor(field) === null,
);

// The built-in admin client is the one client a tenant's administration
// roles hang from, so a field that decides whether a token reaches the
// admin API at all — `audiences`, which carries the admin API's resource
// identifier, as much as `grant_types` or `enabled` — can lock every
// administrator of that tenant out, recoverable only through `psql`. An
// allowlist rather than a denylist: a column added to either table is
// refused on this client until somebody decides otherwise.
export const BUILTIN_ADMIN_AMENDABLE_FIELDS: readonly string[] = [
  'name',
  'consent_required',
  'frontchannel_logout_uri',
  'backchannel_logout_uri',
  'frontchannel_logout_session_required',
  'backchannel_logout_session_required',
  'userinfo_signed_response_alg',
  'userinfo_encrypted_response_alg',
  'userinfo_encrypted_response_enc',
];

export const BUILTIN_ADMIN_GUARDED_FIELDS: readonly string[] = AMENDABLE_CLIENT_FIELDS.filter(
  (field) => !BUILTIN_ADMIN_AMENDABLE_FIELDS.includes(field),
);
