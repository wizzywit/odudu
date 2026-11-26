-- The card of a console assistant's pending write, kept beside the P5 approval
-- it belongs to: the tool, the call that proposed it and what the person is
-- shown (title, target, the state the server read, the change). The approval
-- row holds the decision and its digest; this row says which conversation and
-- which tool call it is for, so a decision and a resumed run find each other
-- and a conversation lists its own. It goes with its approval and with its
-- conversation.
CREATE TABLE IF NOT EXISTS assistant_approvals (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  approval_id uuid NOT NULL REFERENCES agent_approvals (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  tool_call_id text NOT NULL,
  tool text NOT NULL,
  card jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_approvals_pkey PRIMARY KEY (approval_id),
  CONSTRAINT assistant_approvals_conversation_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES assistant_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_approvals_tool_call_length CHECK (char_length(tool_call_id) BETWEEN 1 AND 256),
  CONSTRAINT assistant_approvals_tool_length CHECK (char_length(tool) BETWEEN 1 AND 64),
  CONSTRAINT assistant_approvals_card_shape CHECK (
    jsonb_typeof(card) = 'object' AND octet_length(card::text) <= 65536
  )
);

-- One card per tool call of a conversation, and the index a conversation's
-- pending cards are read through.
CREATE UNIQUE INDEX IF NOT EXISTS assistant_approvals_call
  ON assistant_approvals (tenant_id, conversation_id, tool_call_id);

ALTER TABLE assistant_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_approvals_isolation ON assistant_approvals;
CREATE POLICY assistant_approvals_isolation ON assistant_approvals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
