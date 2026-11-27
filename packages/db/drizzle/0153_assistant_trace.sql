-- The console assistant's trace: what a turn did and why, with the content the
-- audit trail must not carry (tool inputs and outputs, the model's text, the
-- choices made around each model call). One row per turn, one per model call
-- (a step), and an ordered list of events under the turn. Content is bounded
-- here as well as by the writer: an event holds at most 16 KiB and a turn at
-- most 500 events (ADR 0058). The system prompt is not stored, only its hash.
-- Everything goes with its conversation; retention removes it sooner.
CREATE TABLE IF NOT EXISTS assistant_turns (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  profile text NOT NULL,
  prompt_hash text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  stop_reason text,
  CONSTRAINT assistant_turns_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT assistant_turns_conversation_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES assistant_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_turns_profile_length CHECK (char_length(profile) BETWEEN 1 AND 64),
  CONSTRAINT assistant_turns_prompt_hash_shape CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT assistant_turns_stop_reason_length CHECK (
    stop_reason IS NULL OR char_length(stop_reason) BETWEEN 1 AND 64
  )
);

-- A conversation's turns in order, and the tenant's turns by age, which is how
-- retention finds what is old without reading the rest.
CREATE INDEX IF NOT EXISTS assistant_turns_conversation
  ON assistant_turns (tenant_id, conversation_id, started_at);
CREATE INDEX IF NOT EXISTS assistant_turns_started
  ON assistant_turns (tenant_id, started_at);

CREATE TABLE IF NOT EXISTS assistant_steps (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  id uuid NOT NULL,
  -- The step of another run that spawned this one, for a sub-agent.
  parent_step_id uuid,
  slot text NOT NULL,
  model text NOT NULL,
  provider_request_id text,
  input_tokens integer,
  output_tokens integer,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT assistant_steps_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT assistant_steps_turn_fk FOREIGN KEY (tenant_id, turn_id)
    REFERENCES assistant_turns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_steps_parent_fk FOREIGN KEY (tenant_id, parent_step_id)
    REFERENCES assistant_steps (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_steps_slot_check CHECK (slot IN ('fast', 'standard', 'deep')),
  CONSTRAINT assistant_steps_model_length CHECK (char_length(model) BETWEEN 1 AND 200),
  CONSTRAINT assistant_steps_request_id_length CHECK (
    provider_request_id IS NULL OR char_length(provider_request_id) BETWEEN 1 AND 256
  ),
  CONSTRAINT assistant_steps_tokens_floor CHECK (
    (input_tokens IS NULL OR input_tokens >= 0) AND (output_tokens IS NULL OR output_tokens >= 0)
  )
);

-- A turn's steps; also what deleting a turn finds them through.
CREATE INDEX IF NOT EXISTS assistant_steps_turn ON assistant_steps (tenant_id, turn_id, started_at);
-- Deleting a step finds the steps it spawned.
CREATE INDEX IF NOT EXISTS assistant_steps_parent
  ON assistant_steps (tenant_id, parent_step_id)
  WHERE parent_step_id IS NOT NULL;

-- A turn's events in the order they happened. step_id is empty for a choice
-- made before a model call (the slot, a reservation, the tools offered).
CREATE TABLE IF NOT EXISTS assistant_events (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  seq integer NOT NULL,
  step_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  at timestamptz NOT NULL,
  CONSTRAINT assistant_events_pkey PRIMARY KEY (tenant_id, turn_id, seq),
  CONSTRAINT assistant_events_turn_fk FOREIGN KEY (tenant_id, turn_id)
    REFERENCES assistant_turns (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_events_step_fk FOREIGN KEY (tenant_id, step_id)
    REFERENCES assistant_steps (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_events_seq_range CHECK (seq BETWEEN 0 AND 499),
  CONSTRAINT assistant_events_kind_check CHECK (
    kind IN (
      'model_call', 'text', 'tool_call', 'tool_result', 'tool_error', 'error',
      'slot_chosen', 'reservation', 'narrowing', 'policy', 'trimming', 'truncated'
    )
  ),
  -- The writer cuts a payload at 8 KiB; this is twice that, which leaves room for
  -- the spaces PostgreSQL adds when it prints jsonb, and fails closed beyond it.
  CONSTRAINT assistant_events_payload_shape CHECK (
    jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384
  )
);

-- Deleting a step finds the events that name it.
CREATE INDEX IF NOT EXISTS assistant_events_step
  ON assistant_events (tenant_id, step_id)
  WHERE step_id IS NOT NULL;

ALTER TABLE assistant_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_turns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_turns_isolation ON assistant_turns;
CREATE POLICY assistant_turns_isolation ON assistant_turns
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assistant_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_steps_isolation ON assistant_steps;
CREATE POLICY assistant_steps_isolation ON assistant_steps
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assistant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_events_isolation ON assistant_events;
CREATE POLICY assistant_events_isolation ON assistant_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
