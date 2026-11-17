-- How recent a sign-in must be for the "me" API to accept a sensitive change
-- on it, in seconds. A constant default, so adding the column rewrites no
-- row, and IF NOT EXISTS so the statement can run again to no effect. The
-- bound keeps a tenant from turning the gate off (under half a minute leaves
-- no time to answer a challenge) or into no gate at all (over an hour).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS session_freshness_seconds integer NOT NULL DEFAULT 300;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_session_freshness_range'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_session_freshness_range
      CHECK (session_freshness_seconds >= 30 AND session_freshness_seconds <= 3600);
  END IF;
END $$;
