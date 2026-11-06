-- What the admin API remembers of a POST that carried an Idempotency-Key, so
-- a retry of it is answered from here and does not run again. A row is written
-- in the transaction of the call it records, and only for a success, so a row
-- proves the call happened. A key is kept for 24 hours and `odudu reap`
-- deletes the rows past it; a tenant holds at most 10,000 live ones, which the
-- writer enforces under an advisory lock. `fingerprint` binds the request to
-- the caller that made it. Each statement writes only what is missing, so the
-- file can run again to no effect.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id        uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key              text NOT NULL,
  route            text NOT NULL,
  fingerprint      text NOT NULL,
  status           text NOT NULL,
  response_status  integer NOT NULL,
  response_body    text NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key, route),
  CONSTRAINT idempotency_keys_key_length CHECK (length(key) BETWEEN 1 AND 255),
  CONSTRAINT idempotency_keys_route_length CHECK (length(route) <= 512),
  CONSTRAINT idempotency_keys_fingerprint_shape CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_keys_status CHECK (status = 'completed'),
  CONSTRAINT idempotency_keys_response_status CHECK (response_status BETWEEN 200 AND 299),
  CONSTRAINT idempotency_keys_response_body_size CHECK (octet_length(response_body) <= 65536),
  CONSTRAINT idempotency_keys_window CHECK (expires_at > created_at)
);

-- What reap deletes and what the per-tenant ceiling counts, both per tenant:
-- a tenant's live rows are the entries past `now`.
CREATE INDEX IF NOT EXISTS idempotency_keys_by_expiry ON idempotency_keys (tenant_id, expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idempotency_keys_isolation ON idempotency_keys;
CREATE POLICY idempotency_keys_isolation ON idempotency_keys
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
