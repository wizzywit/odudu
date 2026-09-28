-- The admin console gateway's server-side state. A console session holds
-- the administrator's tokens, each wrapped by wrapSecret (@odudu/crypto),
-- and is found by the SHA-256 of its cookie's secret half. A console login
-- is one pending sign-in, keyed by the SHA-256 of its OAuth state and
-- deleted when the callback takes it. The cookie and the state each carry
-- the tenant id in the clear, so both are read under that tenant's context
-- and neither table needs a path around row-level security.
CREATE TABLE console_sessions (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subject_id            uuid NOT NULL,
  secret_hash           bytea NOT NULL UNIQUE,
  access_token_wrapped  text NOT NULL,
  refresh_token_wrapped text NOT NULL,
  id_token_wrapped      text NOT NULL,
  access_expires_at     timestamptz NOT NULL,
  created_at            timestamptz NOT NULL,
  last_seen_at          timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  CONSTRAINT console_sessions_secret_hash_length CHECK (octet_length(secret_hash) = 32),
  CONSTRAINT console_sessions_subject_tenant_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE console_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE console_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY console_sessions_isolation ON console_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE console_logins (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  state_hash       bytea NOT NULL UNIQUE,
  verifier_wrapped text NOT NULL,
  nonce            text NOT NULL,
  return_to        text NOT NULL,
  expires_at       timestamptz NOT NULL,
  CONSTRAINT console_logins_state_hash_length CHECK (octet_length(state_hash) = 32)
);

ALTER TABLE console_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE console_logins FORCE ROW LEVEL SECURITY;

CREATE POLICY console_logins_isolation ON console_logins
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
