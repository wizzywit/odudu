-- What the grant behind an MCP token has changed so far: the calls that made or
-- changed something, and of those the creates. A write is admitted by one
-- UPDATE of the grant's own row, which the row lock makes atomic, so calls made
-- at once cannot between them pass the limit the caller names. The columns are
-- added with a constant default, so no row is rewritten, and no data is read or
-- written, so the file needs no lift of row security for a plain owner. The
-- statement writes only what is missing, so the file can run again to no effect.
ALTER TABLE token_grants
  ADD COLUMN IF NOT EXISTS agent_writes smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_creates smallint NOT NULL DEFAULT 0;
