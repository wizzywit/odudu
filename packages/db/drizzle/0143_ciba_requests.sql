-- One row per backchannel authentication request (OpenID CIBA, poll mode).
-- The auth_req_id is held only as its SHA-256 digest. A request for a person
-- the hint did not resolve to has no subject and no approval: it is kept so
-- the token endpoint answers it exactly as it answers a real one, and it can
-- only run to expiry. hint_digest is the digest of the hint as sent, so the
-- per-person pending limit can be applied to an unresolved request too.
CREATE TABLE IF NOT EXISTS ciba_requests (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid PRIMARY KEY,
  auth_req_hash text NOT NULL,
  client_id uuid NOT NULL,
  subject_id uuid,
  approval_id uuid REFERENCES agent_approvals (id) ON DELETE CASCADE,
  hint_digest text NOT NULL,
  scope text NOT NULL,
  binding_message text,
  requested_expiry integer,
  interval_seconds integer NOT NULL DEFAULT 5,
  last_polled_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ciba_requests_resolved_check
    CHECK ((subject_id IS NULL) = (approval_id IS NULL)),
  CONSTRAINT ciba_requests_interval_floor CHECK (interval_seconds >= 5),
  CONSTRAINT ciba_requests_client_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ciba_requests_subject_fk FOREIGN KEY (tenant_id, subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ciba_requests_auth_req_hash
  ON ciba_requests (tenant_id, auth_req_hash);
CREATE INDEX IF NOT EXISTS ciba_requests_client ON ciba_requests (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS ciba_requests_subject ON ciba_requests (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS ciba_requests_approval ON ciba_requests (approval_id);
CREATE INDEX IF NOT EXISTS ciba_requests_hint
  ON ciba_requests (tenant_id, hint_digest, expires_at) WHERE subject_id IS NULL;
CREATE INDEX IF NOT EXISTS ciba_requests_expires_at ON ciba_requests (expires_at);

ALTER TABLE ciba_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ciba_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ciba_requests_isolation ON ciba_requests;
CREATE POLICY ciba_requests_isolation ON ciba_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The CIBA grant's URN joins the registrable list; the redirect-uri rule
-- beside the constraint (0007) is untouched, so a client holding it still
-- registers a redirect URI.
ALTER TABLE client_oidc_config DROP CONSTRAINT client_oidc_config_grant_types_check;
ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_grant_types_check
  CHECK (grant_types <@ ARRAY[
    'authorization_code',
    'refresh_token',
    'client_credentials',
    'urn:ietf:params:oauth:grant-type:token-exchange',
    'urn:openid:params:grant-type:ciba'
  ]);
