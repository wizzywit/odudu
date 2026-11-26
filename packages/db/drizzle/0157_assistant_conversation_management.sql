-- A person's own conversations: hiding one from their list, listing them, and
-- deleting one. Archiving sets a timestamp and removes nothing. The list reads
-- one person's rows in one of two states through a partial index each, so
-- neither state walks the other's rows; the older index over both states no
-- longer serves a read and goes.
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS assistant_conversations_owner_open
  ON assistant_conversations (tenant_id, owner_subject_id, last_active_at DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS assistant_conversations_owner_archived
  ON assistant_conversations (tenant_id, owner_subject_id, last_active_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
DROP INDEX IF EXISTS assistant_conversations_owner_activity;

-- What stays when a person deletes a conversation: that it existed, whose it
-- was, when it began and was last used, who deleted it and when, how much it
-- held, and a keyed digest of its messages. The text, the trace and the cards
-- are gone with the conversation row. The digest is an HMAC under a key derived
-- per tenant, so it confirms a copy of the text to whoever holds the key and
-- tells nobody else anything. It leaves with the person it belongs to, as the
-- conversation would have, and with the tenant; the audit rows remain.
CREATE TABLE IF NOT EXISTS assistant_conversation_tombstones (
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  target_tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE,
  profile text NOT NULL,
  created_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL,
  deleted_at timestamptz NOT NULL,
  deleted_by_subject_id uuid NOT NULL,
  message_count integer NOT NULL,
  turn_count integer NOT NULL,
  digest text NOT NULL,
  CONSTRAINT assistant_conversation_tombstones_pkey PRIMARY KEY (tenant_id, conversation_id),
  CONSTRAINT assistant_conversation_tombstones_owner_fk FOREIGN KEY (tenant_id, owner_subject_id)
    REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);

-- The two foreign keys that the primary key does not lead: a person's deletion
-- finds their tombstones by the first, and a target tenant's by the second,
-- which holds only the rows bound to one.
CREATE INDEX IF NOT EXISTS assistant_conversation_tombstones_owner
  ON assistant_conversation_tombstones (tenant_id, owner_subject_id);
CREATE INDEX IF NOT EXISTS assistant_conversation_tombstones_target
  ON assistant_conversation_tombstones (target_tenant_id, tenant_id)
  WHERE target_tenant_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_conversation_tombstones_counts_floor'
  ) THEN
    ALTER TABLE assistant_conversation_tombstones
      ADD CONSTRAINT assistant_conversation_tombstones_counts_floor
      CHECK (message_count >= 0 AND turn_count >= 0) NOT VALID;
    ALTER TABLE assistant_conversation_tombstones
      VALIDATE CONSTRAINT assistant_conversation_tombstones_counts_floor;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_conversation_tombstones_digest_shape'
  ) THEN
    ALTER TABLE assistant_conversation_tombstones
      ADD CONSTRAINT assistant_conversation_tombstones_digest_shape
      CHECK (digest ~ '^[0-9a-f]{64}$') NOT VALID;
    ALTER TABLE assistant_conversation_tombstones
      VALIDATE CONSTRAINT assistant_conversation_tombstones_digest_shape;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_conversation_tombstones_target_not_home'
  ) THEN
    ALTER TABLE assistant_conversation_tombstones
      ADD CONSTRAINT assistant_conversation_tombstones_target_not_home
      CHECK (target_tenant_id IS NULL OR target_tenant_id <> tenant_id) NOT VALID;
    ALTER TABLE assistant_conversation_tombstones
      VALIDATE CONSTRAINT assistant_conversation_tombstones_target_not_home;
  END IF;
END $$;

ALTER TABLE assistant_conversation_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_conversation_tombstones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_conversation_tombstones_isolation
  ON assistant_conversation_tombstones;
CREATE POLICY assistant_conversation_tombstones_isolation ON assistant_conversation_tombstones
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
