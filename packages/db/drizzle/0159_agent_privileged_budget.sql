-- A second pair of counters for the writes that change who can sign in, what a
-- token carries or what goes live, so that a burst of changes to wording or
-- descriptions cannot spend what those need: one on the grant the writes are
-- counted against and one on the owner's daily window. Both are added with a
-- constant default, so no row is rewritten, and no data is read or written, so
-- the file needs no lift of row security. The statements write only what is
-- missing, so the file can run again to no effect.
ALTER TABLE token_grants
  ADD COLUMN IF NOT EXISTS agent_privileged_writes smallint NOT NULL DEFAULT 0;

ALTER TABLE agent_budget_windows
  ADD COLUMN IF NOT EXISTS privileged_writes integer NOT NULL DEFAULT 0;
