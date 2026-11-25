-- The console assistant's conversations and the messages in them, held in
-- PostgreSQL so a turn resumes on any server instance. instance_id names the
-- agent instance the conversation acts as, without a foreign key: the trace
-- outlives the instance's tombstone and must keep naming it.
CREATE TABLE IF NOT EXISTS assistant_conversations (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  profile text NOT NULL,
  mode text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a person reports an answer; keeps the conversation past retention.
  reported_at timestamptz,
  CONSTRAINT assistant_conversations_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT assistant_conversations_owner_fk FOREIGN KEY (tenant_id, owner_subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_conversations_mode_check CHECK (mode IN ('ask', 'act')),
  CONSTRAINT assistant_conversations_profile_length CHECK (char_length(profile) BETWEEN 1 AND 64),
  CONSTRAINT assistant_conversations_title_length CHECK (
    title IS NULL OR char_length(title) BETWEEN 1 AND 200
  )
);

-- A person's conversations, newest first; id breaks a tie so a cursor never
-- skips or repeats a row.
CREATE INDEX IF NOT EXISTS assistant_conversations_owner_activity
  ON assistant_conversations (tenant_id, owner_subject_id, last_active_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  seq integer NOT NULL,
  role text NOT NULL,
  parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_messages_pkey PRIMARY KEY (tenant_id, conversation_id, seq),
  CONSTRAINT assistant_messages_conversation_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES assistant_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_messages_seq_floor CHECK (seq >= 1),
  CONSTRAINT assistant_messages_role_check CHECK (role IN ('system', 'user', 'assistant')),
  CONSTRAINT assistant_messages_parts_shape CHECK (
    jsonb_typeof(parts) = 'array' AND octet_length(parts::text) <= 1048576
  )
);

ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_conversations_isolation ON assistant_conversations;
CREATE POLICY assistant_conversations_isolation ON assistant_conversations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_messages_isolation ON assistant_messages;
CREATE POLICY assistant_messages_isolation ON assistant_messages
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
