import type { SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { hasRelay } from '#/entities/mail-relay';
import { publishedLane, readyToPromote } from '#/entities/signing-key';
import type { AttentionInputs } from '#/pages/overview/services/attention';
import type { EntityRules } from '#/pages/overview/services/entityRules';
import type { AreaOf, OverviewRead, OverviewReads } from '#/pages/overview/types/overviewReads';
import type { AdminCapability, Authority } from '#/shared/lib/services/principal';

export const retry = (): void => undefined;

export const OFF: OverviewRead<never> = { status: 'off' };

export const LOADING: OverviewRead<never> = { status: 'loading' };

export const FAILED: OverviewRead<never> = { status: 'failed', refused: false, retry };

export const REFUSED: OverviewRead<never> = { status: 'failed', refused: true, retry };

export function ready<T>(data: T): OverviewRead<T> {
  return { status: 'ready', data };
}

export function authority(...capabilities: Authority['capabilities'][number][]): Authority {
  return { capabilities, crossTenant: false };
}

const AREAS: Readonly<Record<string, { label: string; capability: AdminCapability | null }>> = {
  subjects: { label: 'Subjects', capability: 'view-users' },
  clients: { label: 'Clients', capability: 'manage-clients' },
  groups: { label: 'Groups', capability: 'manage-tenant' },
  roles: { label: 'Roles', capability: 'manage-tenant' },
  scopes: { label: 'Scopes', capability: 'manage-tenant' },
  email: { label: 'Email', capability: 'manage-tenant' },
  keys: { label: 'Signing keys', capability: 'manage-keys' },
  settings: { label: 'Settings', capability: 'manage-tenant' },
  audit: { label: 'Audit trail', capability: 'view-audit' },
};

export const areaOf: AreaOf = (path) => {
  const found = AREAS[path];
  if (found === undefined) throw new Error(`no area ${path}`);
  return { label: found.label, capability: found.capability, href: `/console/acme/${path}` };
};

export function reads(over: Partial<OverviewReads> = {}): OverviewReads {
  return {
    discovery: OFF,
    jwks: OFF,
    counts: { subjects: OFF, clients: OFF, groups: OFF, roles: OFF, scopes: OFF },
    settings: OFF,
    smtp: OFF,
    keys: OFF,
    audit: OFF,
    ...over,
  };
}

export const KEYS: readonly SigningKey[] = [
  {
    id: 'a',
    status: 'active',
    kid: 'kid-a',
    alg: 'ES256',
    created_at: '2026-09-01T00:00:00Z',
    not_after: null,
  },
  {
    id: 'r',
    status: 'rotating',
    kid: 'kid-r',
    alg: 'ES256',
    created_at: '2026-09-02T00:00:00Z',
    not_after: null,
  },
];

export const SMTP_NONE: SmtpConfig = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

export const RULES: EntityRules = { readyToPromote, hasRelay, publishedLane };

export const QUIET: AttentionInputs = {
  settings: {
    verify_email: false,
    reset_password_allowed: false,
    client_registration_policy: 'disabled',
    max_clients: 200,
  },
  smtp: SMTP_NONE,
  keys: KEYS,
  clients: { count: 3, capped: false },
  // Half an hour after the rotating key was staged.
  now: new Date('2026-09-02T00:30:00Z'),
  rules: RULES,
};

// Real bodies from the console-paths transcript (the discovery document of
// the system tenant, the JWKS of a tenant with one signing key).
export const TRANSCRIPT_DISCOVERY = {
  issuer: 'http://localhost:3082/tenants/system',
  authorization_endpoint: 'http://localhost:3082/tenants/system/protocol/openid-connect/auth',
  token_endpoint: 'http://localhost:3082/tenants/system/protocol/openid-connect/token',
  introspection_endpoint:
    'http://localhost:3082/tenants/system/protocol/openid-connect/token/introspect',
  revocation_endpoint: 'http://localhost:3082/tenants/system/protocol/openid-connect/revoke',
  userinfo_endpoint: 'http://localhost:3082/tenants/system/protocol/openid-connect/userinfo',
  jwks_uri: 'http://localhost:3082/tenants/system/protocol/openid-connect/certs',
  end_session_endpoint: 'http://localhost:3082/tenants/system/protocol/openid-connect/logout',
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  userinfo_signing_alg_values_supported: ['ES256', 'none'],
  userinfo_encryption_alg_values_supported: [
    'RSA-OAEP-256',
    'ECDH-ES',
    'ECDH-ES+A128KW',
    'ECDH-ES+A192KW',
    'ECDH-ES+A256KW',
  ],
  userinfo_encryption_enc_values_supported: [
    'A128CBC-HS256',
    'A192CBC-HS384',
    'A256CBC-HS512',
    'A128GCM',
    'A192GCM',
    'A256GCM',
  ],
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: [
    'authorization_code',
    'refresh_token',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:token-exchange',
  ],
  token_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
    'none',
    'private_key_jwt',
  ],
  introspection_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
    'private_key_jwt',
    'none',
  ],
  revocation_endpoint_auth_methods_supported: [
    'client_secret_basic',
    'client_secret_post',
    'private_key_jwt',
    'none',
  ],
  authorization_response_iss_parameter_supported: true,
  claims_parameter_supported: true,
  ui_locales_supported: ['en'],
  prompt_values_supported: ['none', 'login', 'consent', 'select_account'],
  backchannel_logout_supported: true,
  backchannel_logout_session_supported: true,
  frontchannel_logout_supported: true,
  frontchannel_logout_session_supported: true,
  scopes_supported: [
    'address',
    'email',
    'groups',
    'offline_access',
    'openid',
    'phone',
    'profile',
    'roles',
  ],
  claims_supported: [
    'sub',
    'name',
    'given_name',
    'family_name',
    'middle_name',
    'nickname',
    'preferred_username',
    'profile',
    'picture',
    'website',
    'gender',
    'birthdate',
    'zoneinfo',
    'locale',
    'updated_at',
    'email',
    'email_verified',
    'roles',
    'groups',
    'address',
    'phone_number',
    'phone_number_verified',
  ],
};

export const TRANSCRIPT_JWKS = {
  keys: [
    {
      kty: 'RSA',
      n: 'lraNFVOr79JY8qqcZdDshqkjsQSPpd8XmqNT-Zpq65MSgLTfkDmhtrdY6y-xDLyH4SNHCzGIEX5Y_WnNc9egH5as8Q2C7ucd0f2dU6ZoNupSJtcoUmYSkzOwHqLD2NhFEGWbLan0rIrTMZwxuUBAPrnMr6zwiZW9kaISCpP6KuKyulFJnVo7cdRcSWkkfZTvFODJpJeWzZ59YEnVr6yMes-1nQbJWvOVpH4T2dc3CX70PWOoadRFgm2FcwwlyidwdhC7GuNvVbjHajmNU96PgtliVOCDzIH9DLg8koXWCG_ruEQ_ZRgRTm6ndKBalMFUzsSnZ22n8APa1nW9DNYLlw',
      e: 'AQAB',
      kid: '01a0ea7f-01af-7637-a8b5-093872f1685f',
      alg: 'RS256',
      use: 'sig',
    },
  ],
};
