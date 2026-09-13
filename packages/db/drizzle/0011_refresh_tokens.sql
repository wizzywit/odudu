CREATE TABLE refresh_tokens (
  token_hash  text PRIMARY KEY,
  realm_id    uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  grant_id    uuid NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  replaced_by text,
  CONSTRAINT refresh_tokens_grant_fk FOREIGN KEY (realm_id, grant_id)
    REFERENCES token_grants(realm_id, id) ON DELETE CASCADE
);

-- The family is the grant: this index is what makes revoking it one
-- statement (an UPDATE of token_grants keyed on grant_id, not a scan of
-- every refresh token ever issued to it).
CREATE INDEX refresh_tokens_by_grant ON refresh_tokens (realm_id, grant_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- The client_credentials grant has no consent screen and no authorization
-- request to intersect scope against, so the client's own allowlist is the
-- only ceiling on what it can request. Distinct from the OIDC scope
-- vocabulary the authorization_code grant intersects against
-- SUPPORTED_SCOPES: these are resource-server scopes (e.g. `reports:read`),
-- meaningless to a human-facing consent screen and irrelevant to any grant
-- that involves one.
ALTER TABLE client_oidc_config
  ADD COLUMN client_credentials_scopes text[] NOT NULL DEFAULT '{}';
