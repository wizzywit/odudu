import type { AdminCapability } from '#/shared/lib/services/principal';

export type ClientType = 'public' | 'confidential';

// A scope as a client carries it.
export interface ClientScopeAssignment {
  id: string;
  name: string;
  assignment: 'default' | 'optional';
}

export interface Client {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  name_i18n: Record<string, string>;
  description_i18n: Record<string, string>;
  type: ClientType;
  enabled: boolean;
  full_scope_allowed: boolean;
  skip_logout_confirmation: boolean;
  registration_origin: 'seeded' | 'anonymous' | 'token' | 'operator' | 'cimd';
  created_at: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  audiences: string[];
  access_token_ttl_seconds: number | null;
  id_token_ttl_seconds: number | null;
  refresh_token_ttl_seconds: number | null;
  client_credentials_scopes: string[];
  web_origins: string[];
  post_logout_redirect_uris: string[];
  jwks: unknown;
  jwks_uri: string | null;
  frontchannel_logout_uri: string | null;
  backchannel_logout_uri: string | null;
  frontchannel_logout_session_required: boolean;
  backchannel_logout_session_required: boolean;
  consent_required: boolean;
  token_exchange_impersonation_allowed: boolean;
  token_exchange_allowed_for_public: boolean;
  token_exchange_actor_from_other_client: boolean;
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
  scopes: ClientScopeAssignment[];
  // What the client's service account holds of the admin vocabulary: derived
  // on every read and outside the ETag; empty for a client with no account.
  service_account_admin_reach: AdminCapability[];
}
