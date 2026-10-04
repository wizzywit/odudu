-- OpenID Connect Dynamic Client Registration 1.0 §2's per-client ID token
-- settings. Null signs with the tenant's active key, as before; a value
-- names an algorithm the tenant must hold a key for, which the writers check
-- and key retirement refuses to break. default_max_age stands in for a
-- request's own max_age when it carries none; require_auth_time puts
-- auth_time in every ID token the client is issued.
ALTER TABLE client_oidc_config
  ADD COLUMN id_token_signed_response_alg text,
  ADD COLUMN default_max_age integer,
  ADD COLUMN require_auth_time boolean NOT NULL DEFAULT false;

ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_id_token_alg_check
  CHECK (id_token_signed_response_alg IN ('RS256', 'ES256'));
ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_default_max_age_range
  CHECK (default_max_age >= 0);
