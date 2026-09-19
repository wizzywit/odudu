-- An operator's authorization for a client to exist. Copied from
-- action_tokens: 256 bits of randomness stored as its SHA-256 digest and
-- found by that digest, because the value is not a password and has to be
-- looked up rather than compared.
CREATE TABLE client_registration_tokens (
  id             uuid PRIMARY KEY,
  realm_id       uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  token_hash     text NOT NULL,
  remaining_uses integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  CONSTRAINT client_registration_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT client_registration_tokens_uses_range CHECK (remaining_uses >= 0)
);

ALTER TABLE client_registration_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_registration_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY client_registration_tokens_isolation ON client_registration_tokens
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
