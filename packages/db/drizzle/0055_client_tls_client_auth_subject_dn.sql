-- RFC 8705 §2.1.2's own metadata name: the expected subject distinguished
-- name of the certificate a tls_client_auth client presents. Every other
-- auth method leaves it null; required exactly when
-- token_endpoint_auth_method is tls_client_auth, mirroring how
-- client_oidc_config_userinfo_enc_needs_alg conditions one column on
-- another's value.
ALTER TABLE client_oidc_config
  ADD COLUMN tls_client_auth_subject_dn text;

ALTER TABLE client_oidc_config
  ADD CONSTRAINT client_oidc_config_tls_client_auth_needs_subject_dn
  CHECK (token_endpoint_auth_method <> 'tls_client_auth' OR tls_client_auth_subject_dn IS NOT NULL);
