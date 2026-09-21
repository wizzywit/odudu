-- Every jti a client assertion (RFC 7523 §3) has spent, until it could no
-- longer be replayed. oauth_client_id is the OAuth client_id string the
-- assertion names, not clients.id's surrogate uuid -- a different
-- namespace, with no foreign key here: a replay is refused even for a
-- client_id that resolves to nothing, and a deleted client's rows fall
-- out once they pass expires_at, via this table's own retention pass.
-- The primary key rejects the replay: a second insert of the same
-- (realm, client, jti) conflicts, rather than being looked up and raced.
CREATE TABLE client_assertion_jti (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  oauth_client_id text NOT NULL,
  jti text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (realm_id, oauth_client_id, jti)
);

ALTER TABLE client_assertion_jti ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assertion_jti FORCE ROW LEVEL SECURITY;

CREATE POLICY client_assertion_jti_isolation ON client_assertion_jti
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

CREATE INDEX client_assertion_jti_expiry ON client_assertion_jti (realm_id, expires_at);
