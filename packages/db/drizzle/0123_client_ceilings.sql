-- `max_clients` is the operator's ceiling and counts only the clients an
-- operator made (origins seeded, operator, token); clients that arrived over
-- the wire are held to ceilings of their own. These indexes serve the two
-- counts and the self-registered client the registration endpoint evicts at
-- its ceiling, and the sign-in lookup by client that every eviction and reap
-- candidate makes. `idempotency_keys.response_headers` gets the size bound its
-- sibling column has. Each statement writes only what is missing, so the file
-- can run again to no effect.
CREATE INDEX IF NOT EXISTS clients_operator_by_tenant ON clients (tenant_id)
  WHERE registration_origin NOT IN ('cimd', 'anonymous');

CREATE INDEX IF NOT EXISTS clients_anonymous_by_created ON clients (tenant_id, created_at, id)
  WHERE registration_origin = 'anonymous';

CREATE INDEX IF NOT EXISTS authentication_sessions_by_pending_client
  ON authentication_sessions (tenant_id, (pending_request ->> 'clientId'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_response_headers_size') THEN
    ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_response_headers_size
      CHECK (octet_length(response_headers::text) <= 8192);
  END IF;
END $$;
