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
  type: 'confidential',
  enabled: true,
  full_scope_allowed: false,
  registration_origin: 'operator',
  redirect_uris: ['https://billing.example/callback'],
  grant_types: ['authorization_code'],
  token_endpoint_auth_method: 'client_secret_basic',
  audiences: [],
  access_token_ttl_seconds: 300,
  refresh_token_ttl_seconds: 1_209_600,
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
  service_account_roles: [{ name: 'billing-reader', client: null }],
};

const DOCUMENT: TenantDocument = {
  version: 1,
  settings: { display_name: null, password_min_length: 12, username_editable: false },
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
  groups: [{ path: '/finance', roles: [{ name: 'billing-reader', client: null }] }],
  scopes: [
    {
      name: 'openid',
      description: null,
      include_in_id_token: true,
      include_in_access_token: false,
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
