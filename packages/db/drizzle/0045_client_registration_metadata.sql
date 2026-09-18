ALTER TABLE client_oidc_config
  ADD COLUMN jwks                                jsonb,
  ADD COLUMN jwks_uri                            text,
  ADD COLUMN frontchannel_logout_uri             text,
  ADD COLUMN backchannel_logout_uri              text,
  ADD COLUMN backchannel_logout_session_required boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_required                    boolean NOT NULL DEFAULT false,
  ADD COLUMN userinfo_signed_response_alg        text,
  ADD COLUMN userinfo_encrypted_response_alg     text,
  ADD COLUMN userinfo_encrypted_response_enc     text;

-- RFC 7591 §2 makes the two mutually exclusive: a client states its keys by
-- value or by reference, never both, so nothing downstream has to decide
-- which one wins.
ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_one_key_source
  CHECK (jwks IS NULL OR jwks_uri IS NULL);

-- OIDC Core §5.3.2 lets a response be encrypted without being signed, so
-- `enc` is what an encrypted response requires, not `alg` implying `enc`.
ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_userinfo_enc_needs_alg
  CHECK (userinfo_encrypted_response_enc IS NULL OR userinfo_encrypted_response_alg IS NOT NULL);

ALTER TABLE client_oidc_config
  DROP CONSTRAINT client_oidc_config_auth_method_check;
ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_auth_method_check
  CHECK (token_endpoint_auth_method IN
    ('client_secret_basic', 'client_secret_post', 'none', 'private_key_jwt', 'tls_client_auth'));

-- How this client came to exist, which is what decides whether consent is
-- required by default: an operator seeding a client and an operator issuing
-- a registration token are both an authorization for it to exist, and an
-- anonymous registration is not. RFC 7591 §5, and the same split Keycloak's
-- anonymous-versus-authenticated registration policies make.
ALTER TABLE clients
  ADD COLUMN registration_origin text NOT NULL DEFAULT 'seeded';
ALTER TABLE clients
  ADD CONSTRAINT clients_registration_origin_check
  CHECK (registration_origin IN ('seeded', 'anonymous', 'token'));

ALTER TABLE realms
  ADD COLUMN client_registration_policy text NOT NULL DEFAULT 'disabled',
  ADD COLUMN max_clients integer NOT NULL DEFAULT 200;
ALTER TABLE realms
  ADD CONSTRAINT realms_client_registration_policy_check
  CHECK (client_registration_policy IN ('disabled', 'open', 'token'));
ALTER TABLE realms
  ADD CONSTRAINT realms_max_clients_range CHECK (max_clients >= 0);
