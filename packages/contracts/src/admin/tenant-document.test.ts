import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_POLICY_SETTINGS,
  tenantDocumentSchema,
  type ExportedClient,
  type TenantDocument,
} from '#/admin/tenant-document';

const CLIENT: ExportedClient = {
  client_id: 'billing-app',
  name: 'Billing',
  description: null,
  type: 'confidential',
  enabled: true,
  full_scope_allowed: false,
  registration_origin: 'operator',
  redirect_uris: ['https://billing.example/callback'],
  grant_types: ['authorization_code'],
  token_endpoint_auth_method: 'client_secret_basic',
  audiences: [],
  access_token_ttl_seconds: 300,
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
  service_account_roles: [{ name: 'billing-reader', client: null }],
};

const DOCUMENT: TenantDocument = {
  version: 1,
  settings: {
    display_name: null,
    enabled: true,
    reset_password_allowed: false,
    sso_session_idle_seconds: 1800,
    sso_session_max_seconds: 36_000,
    password_min_length: 12,
    password_require_digit: false,
    password_require_uppercase: false,
    password_require_lowercase: false,
    password_require_special: false,
    password_not_username: true,
    password_not_email: true,
    password_history_depth: 0,
    password_max_age_days: 0,
    otp_required: false,
    brute_force_max_failures: 5,
    brute_force_lockout_seconds: 60,
    brute_force_max_lockout_seconds: 900,
    brute_force_failure_reset_seconds: 43_200,
    max_clients: 200,
    max_sessions_per_browser: 25,
    remember_me_allowed: false,
    remember_me_idle_seconds: 604_800,
    remember_me_max_seconds: 2_592_000,
    audit_retention_days: 90,
    username_editable: false,
    access_token_ttl_seconds: 300,
    id_token_ttl_seconds: 300,
    refresh_token_ttl_seconds: 1_209_600,
    authorization_code_ttl_seconds: 60,
    login_ttl_seconds: 1800,
    verify_email_ttl_seconds: 43_200,
    reset_password_ttl_seconds: 300,
    login_with_email: false,
    audit_event_types: ['admin_mutation', 'admin_access'],
  },
  flow: [{ authenticator: 'password', requirement: 'required' }],
  clients: [CLIENT],
  roles: [
    {
      name: 'billing-reader',
      client: null,
      description: null,
      default_for_new_subjects: false,
      builtin: false,
      composites: [{ name: 'view-users', client: 'odudu-admin' }],
    },
  ],
  groups: [
    {
      path: '/finance',
      description: null,
      default_for_new_subjects: false,
      roles: [{ name: 'billing-reader', client: null }],
    },
  ],
  scopes: [
    {
      name: 'openid',
      description: null,
      include_in_id_token: true,
      include_in_access_token: false,
      default_client_assignment: 'default',
      consent_text: null,
      display_order: 0,
      builtin: true,
      roles: [],
      mappers: [],
      clients: [{ client_id: 'billing-app', assignment: 'default' }],
    },
  ],
  registration_policy: {
    registration_allowed: false,
    verify_email: true,
    client_registration_policy: 'token',
  },
  smtp: null,
  omitted: ['clients[0].secret'],
};

describe('tenantDocumentSchema', () => {
  it('accepts a document with no subjects', () => {
    expect(tenantDocumentSchema.safeParse(DOCUMENT).success).toBe(true);
  });

  it('accepts only version 1', () => {
    expect(tenantDocumentSchema.safeParse({ ...DOCUMENT, version: 2 }).success).toBe(false);
  });

  it('refuses a member it does not define, so a secret cannot ride along unnoticed', () => {
    const withSecret = { ...DOCUMENT, clients: [{ ...CLIENT, secret: 'not-here' }] };
    const result = tenantDocumentSchema.safeParse(withSecret);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['clients', 0]);
  });

  it('refuses a setting it does not name, and a registration setting outside its section', () => {
    for (const extra of [{ password_min_lenght: 12 }, { verify_email: true }]) {
      const document = { ...DOCUMENT, settings: { ...DOCUMENT.settings, ...extra } };
      expect(tenantDocumentSchema.safeParse(document).success, Object.keys(extra)[0]).toBe(false);
    }
  });

  it('refuses a setting of the wrong type', () => {
    const document = { ...DOCUMENT, settings: { ...DOCUMENT.settings, max_clients: '200' } };
    expect(tenantDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('refuses a client registration policy outside its enumeration', () => {
    const document = {
      ...DOCUMENT,
      registration_policy: { ...DOCUMENT.registration_policy, client_registration_policy: 'any' },
    };

    expect(tenantDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('names the registration policy settings by their tenant setting names', () => {
    expect([...REGISTRATION_POLICY_SETTINGS].sort()).toEqual([
      'client_registration_policy',
      'registration_allowed',
      'verify_email',
    ]);
  });
});
