-- The browser a session was opened on: a digest of the device cookie the
-- server set at that browser's first login. Null for a session opened before
-- it existed or with no device cookie, and backfilled with nothing. A
-- nullable column with no default rewrites no row, and IF NOT EXISTS lets the
-- statement run again. No index: the reads that filter on it also filter on
-- the subject, which sessions_by_subject already serves.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS device_id text;
