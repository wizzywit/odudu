import { json, type Answer, type Sent } from '#/testing/fakeTransport.ts';
import { GRACE, whoami } from '#/testing/renderConsole.tsx';
import { EVERY_TENANT_CAPABILITY } from '#/testing/subjectsFixtures.ts';

export const A = '/console/api/admin/tenants/acme';
export const C = `${A}/clients`;

export interface ClientAnswer {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  type: 'public' | 'confidential';
  enabled: boolean;
  full_scope_allowed: boolean;
  registration_origin: 'seeded' | 'anonymous' | 'token' | 'operator';
  created_at: string;
  redirect_uris: readonly string[];
  grant_types: readonly string[];
  token_endpoint_auth_method: string;
  audiences: readonly string[];
  access_token_ttl_seconds: number | null;
  id_token_ttl_seconds: number | null;
  refresh_token_ttl_seconds: number | null;
  client_credentials_scopes: readonly string[];
  web_origins: readonly string[];
  post_logout_redirect_uris: readonly string[];
  jwks: unknown;
  jwks_uri: string | null;
  frontchannel_logout_uri: string | null;
  backchannel_logout_uri: string | null;
  frontchannel_logout_session_required: boolean;
  backchannel_logout_session_required: boolean;
  consent_required: boolean;
  token_exchange_impersonation_allowed: boolean;
  userinfo_signed_response_alg: string | null;
  userinfo_encrypted_response_alg: string | null;
  userinfo_encrypted_response_enc: string | null;
  tls_client_auth_subject_dn: string | null;
  client_uri: string | null;
  policy_uri: string | null;
  tos_uri: string | null;
  id_token_signed_response_alg: string | null;
  default_max_age: number | null;
  require_auth_time: boolean;
  previous_secret_expires_at: string | null;
  builtin_admin: boolean;
  service_subject_id: string | null;
  scopes: readonly { id: string; name: string; assignment: 'default' | 'optional' }[];
}

// A service account's id is a uuid on the wire; this one is derived from the client's.
export function serviceAccountOf(id: string): string {
  const hex = Buffer.from(id).toString('hex').slice(0, 12).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

export function client(
  id: string,
  clientId: string,
  extra: Partial<ClientAnswer> = {},
): ClientAnswer {
  return {
    id,
    client_id: clientId,
    name: clientId,
    description: null,
    type: 'confidential',
    enabled: true,
    full_scope_allowed: false,
    registration_origin: 'operator',
    created_at: '2026-09-28T08:41:53.858Z',
    redirect_uris: ['https://billing.example/callback'],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'client_secret_basic',
    audiences: [],
    access_token_ttl_seconds: null,
    id_token_ttl_seconds: null,
    refresh_token_ttl_seconds: null,
    client_credentials_scopes: [],
    web_origins: [],
    post_logout_redirect_uris: [],
    jwks: null,
    jwks_uri: null,
    frontchannel_logout_uri: null,
    backchannel_logout_uri: null,
    frontchannel_logout_session_required: false,
    backchannel_logout_session_required: false,
    consent_required: false,
    token_exchange_impersonation_allowed: false,
    userinfo_signed_response_alg: null,
    userinfo_encrypted_response_alg: null,
    userinfo_encrypted_response_enc: null,
    tls_client_auth_subject_dn: null,
    client_uri: null,
    policy_uri: null,
    tos_uri: null,
    id_token_signed_response_alg: null,
    default_max_age: null,
    require_auth_time: false,
    previous_secret_expires_at: null,
    builtin_admin: false,
    service_subject_id: serviceAccountOf(id),
    scopes: [],
    ...extra,
  };
}

export const BILLING = client('c-bill', 'billing', {
  name: 'Billing',
  description: 'Invoices',
  web_origins: ['https://billing.example'],
});
export const PORTAL = client('c-portal', 'portal', {
  type: 'public',
  token_endpoint_auth_method: 'none',
  service_subject_id: null,
  redirect_uris: ['https://portal.example/cb'],
});
export const ADMIN = client('c-admin', 'odudu-admin', {
  builtin_admin: true,
  name: 'Odudu admin',
});
export const CLIENTS = [ADMIN, BILLING, PORTAL];

function listed(request: Sent) {
  const name = request.search.get('name');
  const clientId = request.search.get('client_id');
  const type = request.search.get('type');
  const enabled = request.search.get('enabled');
  return CLIENTS.filter(
    (each) =>
      (name === null || each.name.toLowerCase().startsWith(name.toLowerCase())) &&
      (clientId === null || each.client_id.startsWith(clientId.toLowerCase())) &&
      (type === null || each.type === type) &&
      (enabled === null || String(each.enabled) === enabled),
  );
}

// What a subject holds, as admin-capabilities answers it: nothing, unless
// `held` names capabilities of the built-in admin client.
export function heldBy(held: readonly string[] = []) {
  return {
    items: held.map((name) => ({
      id: `r-${name}`,
      name,
      client_id: 'c-admin',
      client_key: 'odudu-admin',
      via: [{ kind: 'direct' }],
    })),
    complete: true,
  };
}

// grace of acme, holding the capabilities given, among the built-in admin
// client, billing and portal; every service account holds nothing.
export function clientRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return {
    'GET /console/api/session': json(GRACE),
    [`GET ${A}/whoami`]: whoami(capabilities),
    [`GET ${C}`]: (request) => json({ items: listed(request) })(request),
    [`GET ${C}/count`]: (request) =>
      json({ count: listed(request).length, capped: false })(request),
    ...Object.fromEntries(
      CLIENTS.map((each) => [`GET ${C}/${each.id}`, json(each, 200, { etag: `"${each.id}-1"` })]),
    ),
    ...Object.fromEntries(
      CLIENTS.flatMap((each) =>
        each.service_subject_id === null
          ? []
          : [[`GET ${A}/subjects/${each.service_subject_id}/admin-capabilities`, json(heldBy())]],
      ),
    ),
    [`GET ${A}/audit`]: json({ items: [] }),
    ...extra,
  };
}
