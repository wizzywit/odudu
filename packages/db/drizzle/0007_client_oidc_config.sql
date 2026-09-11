CREATE TABLE client_oidc_config (
  client_id                  uuid PRIMARY KEY,
  realm_id                   uuid NOT NULL,
  redirect_uris              text[] NOT NULL,
  grant_types                text[] NOT NULL,
  token_endpoint_auth_method text NOT NULL,
  audiences                  text[] NOT NULL DEFAULT '{}',
  access_token_ttl_seconds   integer NOT NULL DEFAULT 300,
  refresh_token_ttl_seconds  integer NOT NULL DEFAULT 1209600,
  CONSTRAINT client_oidc_config_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT client_oidc_config_auth_method_check
    CHECK (token_endpoint_auth_method IN ('client_secret_basic', 'client_secret_post', 'none')),
  CONSTRAINT client_oidc_config_grant_types_check
    CHECK (grant_types <@ ARRAY['authorization_code', 'refresh_token', 'client_credentials']),
  -- array_length(redirect_uris, 1) is NULL, not 0, for an empty array —
  -- verified against real PostgreSQL — so `NULL >= 1` is NULL and the CHECK
  -- would pass vacuously on the exact empty-array case this constraint
  -- exists to reject. cardinality() returns 0 for an empty array instead.
  CONSTRAINT client_oidc_config_redirect_uris_present
    CHECK (cardinality(redirect_uris) >= 1 OR grant_types = ARRAY['client_credentials'])
);

ALTER TABLE client_oidc_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
CREATE POLICY client_oidc_config_isolation ON client_oidc_config
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
