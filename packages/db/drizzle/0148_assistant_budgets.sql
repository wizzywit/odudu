-- Token budget ledger for the console assistant. A counter is one spend limit
-- at one level (tenant month, admin day, conversation, turn), optionally per
-- model slot; a reservation holds tokens against every level of one model
-- call until it is settled or swept. Neither table references a conversation,
-- so the ledger outlives the conversation it paid for.
CREATE TABLE IF NOT EXISTS assistant_budget_counters (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  scope_kind text NOT NULL,
  scope_key text NOT NULL,
  slot text,
  used bigint NOT NULL DEFAULT 0,
  limit_tokens bigint NOT NULL,
  window_start timestamptz NOT NULL,
  CONSTRAINT assistant_budget_counters_kind_check CHECK (
    scope_kind IN ('tenant_month', 'admin_day', 'conversation', 'turn')
  ),
  CONSTRAINT assistant_budget_counters_slot_check CHECK (
    slot IS NULL OR slot IN ('fast', 'standard', 'deep')
  ),
  CONSTRAINT assistant_budget_counters_key_length CHECK (char_length(scope_key) BETWEEN 1 AND 128),
  CONSTRAINT assistant_budget_counters_used_floor CHECK (used >= 0),
  CONSTRAINT assistant_budget_counters_limit_floor CHECK (limit_tokens >= 0)
);

-- A counter is named by its level, key and slot; a null slot is its own
-- counter, so the slot enters the key as an empty string.
CREATE UNIQUE INDEX IF NOT EXISTS assistant_budget_counters_scope
  ON assistant_budget_counters (tenant_id, scope_kind, scope_key, (coalesce(slot, '')));

CREATE TABLE IF NOT EXISTS assistant_reservations (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  turn_id uuid NOT NULL,
  slot text NOT NULL,
  reserved bigint NOT NULL,
  -- The counters this reservation was charged to, so settling and sweeping
  -- adjust the same rows (and none that has since moved to a new window).
  levels jsonb NOT NULL,
  sent boolean NOT NULL DEFAULT false,
  settled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_reservations_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT assistant_reservations_slot_check CHECK (slot IN ('fast', 'standard', 'deep')),
  CONSTRAINT assistant_reservations_reserved_floor CHECK (reserved >= 0),
  CONSTRAINT assistant_reservations_levels_shape CHECK (
    jsonb_typeof(levels) = 'array' AND jsonb_array_length(levels) BETWEEN 1 AND 4
  )
);

CREATE INDEX IF NOT EXISTS assistant_reservations_turn
  ON assistant_reservations (tenant_id, turn_id);

-- The sweep reads only what is still open, oldest first.
CREATE INDEX IF NOT EXISTS assistant_reservations_open
  ON assistant_reservations (tenant_id, created_at)
  WHERE NOT settled;

ALTER TABLE assistant_budget_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_budget_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_budget_counters_isolation ON assistant_budget_counters;
CREATE POLICY assistant_budget_counters_isolation ON assistant_budget_counters
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assistant_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_reservations_isolation ON assistant_reservations;
CREATE POLICY assistant_reservations_isolation ON assistant_reservations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
