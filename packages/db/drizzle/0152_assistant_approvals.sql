-- The card of a console assistant's pending write, kept beside the P5 approval
-- it belongs to: the tool, the call that proposed it and what the person is
-- shown (title, target, the state the server read, the change). The approval
-- row holds the decision and its digest; this row says which conversation and
-- which tool call it is for, so a decision and a resumed run find each other
-- and a conversation lists its own. It goes with its approval and with its
-- conversation.
-- The key a card's foreign key names, so a card cannot point at another tenant's approval.
CREATE UNIQUE INDEX IF NOT EXISTS agent_approvals_tenant_id ON agent_approvals (tenant_id, id);
-- It serves every read the plain index of 0146 on the same columns did, so that one goes.
DROP INDEX IF EXISTS agent_approvals_tenant_id_id;

CREATE TABLE IF NOT EXISTS assistant_approvals (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  approval_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  tool_call_id text NOT NULL,
  tool text NOT NULL,
  card jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_approvals_pkey PRIMARY KEY (approval_id),
  CONSTRAINT assistant_approvals_approval_fk FOREIGN KEY (tenant_id, approval_id)
    REFERENCES agent_approvals (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_approvals_conversation_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES assistant_conversations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT assistant_approvals_tool_call_length CHECK (char_length(tool_call_id) BETWEEN 1 AND 256),
  CONSTRAINT assistant_approvals_tool_length CHECK (char_length(tool) BETWEEN 1 AND 64),
  -- A card is bounded by the assistant (each shown value at most 2,000 characters), far under
  -- this; a value whose JSON escaping made the card larger would be refused here, which fails
  -- closed: the proposal is not stored.
  CONSTRAINT assistant_approvals_card_shape CHECK (
    jsonb_typeof(card) = 'object' AND octet_length(card::text) <= 65536
  )
);

-- One card per tool call of a conversation, and the index a conversation's
-- pending cards are read through.
CREATE UNIQUE INDEX IF NOT EXISTS assistant_approvals_call
  ON assistant_approvals (tenant_id, conversation_id, tool_call_id);

-- A conversation's recent cards, newest first: an approval lives at most 15 minutes, so
-- what is still pending is always among the recent ones however long the conversation is.
CREATE INDEX IF NOT EXISTS assistant_approvals_recent
  ON assistant_approvals (tenant_id, conversation_id, created_at DESC);

ALTER TABLE assistant_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_approvals_isolation ON assistant_approvals;
CREATE POLICY assistant_approvals_isolation ON assistant_approvals
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The sweep of write grants a dead process left (the budget upkeep): the live `mcp:write`
-- grants, oldest first, without reading the tenant's other grants.
CREATE INDEX IF NOT EXISTS token_grants_assistant_write_live
  ON token_grants (tenant_id, created_at)
  WHERE scope = 'mcp:write' AND revoked_at IS NULL;
