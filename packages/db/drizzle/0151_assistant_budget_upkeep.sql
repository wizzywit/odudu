-- What the assistant's budget needs to run across servers and to be kept
-- small. A lease is one turn in progress, so a tenant's limit on answers at
-- once is counted in the database and not in each process; it lapses on its
-- own when the process that took it dies. The two indexes serve the upkeep
-- pass: settled reservations and spent counter windows are deleted a bounded
-- batch at a time, in order of age.
CREATE TABLE IF NOT EXISTS assistant_turn_leases (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT assistant_turn_leases_pkey PRIMARY KEY (tenant_id, turn_id),
  CONSTRAINT assistant_turn_leases_lifetime CHECK (expires_at > created_at)
);

-- The count of live leases reads the tenant's rows still before expiry.
CREATE INDEX IF NOT EXISTS assistant_turn_leases_live
  ON assistant_turn_leases (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS assistant_reservations_settled
  ON assistant_reservations (tenant_id, created_at)
  WHERE settled;

CREATE INDEX IF NOT EXISTS assistant_budget_counters_window
  ON assistant_budget_counters (tenant_id, scope_kind, window_start);

ALTER TABLE assistant_turn_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_turn_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_turn_leases_isolation ON assistant_turn_leases;
CREATE POLICY assistant_turn_leases_isolation ON assistant_turn_leases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
