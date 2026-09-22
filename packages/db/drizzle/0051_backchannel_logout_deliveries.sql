-- One row per relying party that must be told a session ended. Written in
-- the same transaction that ends the session, so a delivery cannot be lost
-- to a crash between the two, and drained by `odudu send-logouts`.
-- The client foreign key cascades, as token_grants' own does
-- (0010_token_grants.sql): an endpoint the client no longer registers has
-- no relying party left to receive it, so a queued row for a deleted
-- client is deleted with it rather than retried forever or kept for audit.
CREATE TABLE backchannel_logout_deliveries (
  id uuid PRIMARY KEY,
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  endpoint text NOT NULL,
  logout_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT backchannel_logout_deliveries_client_fk FOREIGN KEY (realm_id, client_id)
    REFERENCES clients (realm_id, id) ON DELETE CASCADE
);

ALTER TABLE backchannel_logout_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE backchannel_logout_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY backchannel_logout_deliveries_isolation ON backchannel_logout_deliveries
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

CREATE INDEX backchannel_logout_deliveries_pending
  ON backchannel_logout_deliveries (realm_id, next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE INDEX backchannel_logout_deliveries_by_delivered
  ON backchannel_logout_deliveries (realm_id, delivered_at);
