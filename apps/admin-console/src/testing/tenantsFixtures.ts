import { json, type Answer } from '#/testing/fakeTransport.ts';
import { ROOT, whoami } from '#/testing/renderConsole.tsx';

export const ADMIN = '/console/api/admin/tenants';
export const ISSUER = 'https://id.example/tenants/system';
export const EVERY_CAPABILITY = [
  'manage-tenants',
  'manage-tenant',
  'manage-users',
  'view-users',
  'manage-clients',
  'manage-keys',
  'manage-sessions',
  'view-audit',
];

export function tenant(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `01a0e72d-7fc7-7950-a1e7-${name
      .padEnd(12, '0')
      .slice(0, 12)
      .replace(/[^0-9a-f]/gu, 'a')}`,
    name,
    display_name: null,
    enabled: true,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

// A system administrator signed in to `system`, holding everything.
export function systemRoutes(extra: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    'GET /console/api/session': json(ROOT),
    [`GET ${ADMIN}/system/whoami`]: whoami(EVERY_CAPABILITY),
    'GET /console/api/tenants/system/discovery': json({ issuer: ISSUER }),
    ...extra,
  };
}

// Everything the first administrator's steps ask of `tenant`, answered.
export function administratorRoutes(
  name: string,
  subjectId: string,
  password: string,
): Record<string, Answer> {
  const T = `${ADMIN}/${name}`;
  return {
    [`POST ${T}/subjects`]: json(
      {
        id: subjectId,
        type: 'user',
        username: 'grace',
        email: null,
        enabled: true,
        created_at: '2026-09-28T08:41:53.858Z',
      },
      201,
    ),
    [`GET ${T}/clients`]: json({
      items: [
        { id: 'c-copy', builtin_admin: false },
        { id: 'c-admin', builtin_admin: true },
      ].map((client) => ({ ...clientDefaults, ...client })),
    }),
    [`GET ${T}/roles`]: json({
      items: [
        {
          id: 'r-admin',
          name: 'tenant-admin',
          description: null,
          client_id: 'c-admin',
          client_key: 'odudu-admin',
          default_for_new_subjects: false,
          created_at: '2026-09-28T08:41:53.858Z',
        },
      ],
    }),
    [`GET ${T}/subjects/${subjectId}/roles`]: json(
      { items: [{ id: 'r-default', name: 'reader', client_id: null, client_key: null }] },
      200,
      { etag: '"roles-1"' },
    ),
    [`PUT ${T}/subjects/${subjectId}/roles`]: json({ items: [] }, 200, { etag: '"roles-2"' }),
    [`POST ${T}/subjects/${subjectId}/password`]: json({ password }, 201),
  };
}

const clientDefaults = {
  client_id: 'odudu-admin',
  name: 'Odudu admin',
  description: null,
  type: 'public',
  enabled: true,
  full_scope_allowed: false,
  registration_origin: 'seeded',
  created_at: '2026-09-28T08:41:53.858Z',
  redirect_uris: [],
  grant_types: [],
  token_endpoint_auth_method: 'none',
  audiences: [],
  access_token_ttl_seconds: 300,
  id_token_ttl_seconds: 300,
  refresh_token_ttl_seconds: 3600,
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
  service_subject_id: null,
  scopes: [],
};
