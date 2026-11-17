-- The client an administrator-issued link returns to, and the one redirect
-- URI of that client's it returns to. The client is not a foreign key: it can
-- be deleted or edited before the link is opened, and the link is then
-- redeemed without a way back rather than refused, so the page checks both
-- against the client's current registration. The pair is held together or not
-- at all. The table already carries its row-level policy.
ALTER TABLE action_tokens
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS return_uri text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'action_tokens_return_check'
  ) THEN
    ALTER TABLE action_tokens ADD CONSTRAINT action_tokens_return_check
      CHECK ((client_id IS NULL) = (return_uri IS NULL));
  END IF;
END $$;
