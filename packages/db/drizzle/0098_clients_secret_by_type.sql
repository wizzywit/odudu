-- A confidential client authenticates with a secret, a signed assertion or a
-- certificate, and only the first leaves a hash on this row; the method is on
-- client_oidc_config, which a CHECK here cannot read. The rule this table can
-- state on its own is the one that protects something: a public client never
-- carries a secret. A confidential client without one cannot authenticate by
-- secret (verifyClientSecret refuses it), so the absence fails closed.
ALTER TABLE clients DROP CONSTRAINT clients_secret_matches_type;
ALTER TABLE clients ADD CONSTRAINT clients_secret_matches_type
  CHECK (type <> 'public' OR secret_hash IS NULL);
