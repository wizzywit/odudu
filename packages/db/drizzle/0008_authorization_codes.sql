CREATE TABLE authorization_codes (
  code_hash             text PRIMARY KEY,
  realm_id              uuid NOT NULL REFERENCES realms(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL,
  subject_id            uuid NOT NULL,
  redirect_uri          text NOT NULL,
  scope                 text NOT NULL,
  nonce                 text,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL,
  auth_time             timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  grant_id              uuid,
  CONSTRAINT authorization_codes_method_check CHECK (code_challenge_method = 'S256'),
  CONSTRAINT authorization_codes_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients(realm_id, id) ON DELETE CASCADE,
  CONSTRAINT authorization_codes_subject_fk FOREIGN KEY (realm_id, subject_id)
    REFERENCES subjects(realm_id, id) ON DELETE CASCADE
);

ALTER TABLE authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY authorization_codes_isolation ON authorization_codes
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);
