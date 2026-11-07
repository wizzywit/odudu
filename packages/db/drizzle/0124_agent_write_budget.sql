-- What the grant behind an MCP token has changed so far: the calls that made or
-- changed something, and of those the creates. A grant made by an exchange
-- names the grant whose counters it spends in `budget_grant_id`, copied from
-- the grant it was exchanged from, so the chain is never walked; the column has
-- no foreign key, so a root the reaper has deleted leaves a name that matches
-- nothing and the budget is refused, never renewed. A grant exchanged before
-- this column existed is given its root below by following the chain down from
-- each grant no exchange made; one whose parent was already deleted cannot be told
-- from a sign-in's own grant and keeps a budget of its own. A write is admitted by one
-- UPDATE of the grant's own row, which the row lock makes atomic, so calls made
-- at once cannot between them pass the limit the caller names. The columns are
-- added with a constant default, so no row is rewritten, and no data is read or
-- written, so the file needs no lift of row security for a plain owner. The
-- statement writes only what is missing, so the file can run again to no effect.
ALTER TABLE token_grants
  ADD COLUMN IF NOT EXISTS agent_writes smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_creates smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_grant_id uuid;

-- token_grants forces row security: for a migrating role that is neither SUPERUSER
-- nor BYPASSRLS (which a supported install never is, ADR 0009) it is lifted for the
-- statement and put back, as in 0119.
DO $$
DECLARE
  plain_owner boolean;
BEGIN
  SELECT NOT (rolsuper OR rolbypassrls) INTO plain_owner FROM pg_roles WHERE rolname = current_user;
  IF plain_owner THEN
    ALTER TABLE token_grants NO FORCE ROW LEVEL SECURITY;
  END IF;

  WITH RECURSIVE chain (id, root) AS (
    SELECT id, id FROM token_grants WHERE exchanged_from_grant_id IS NULL
    UNION ALL
    SELECT g.id, c.root FROM token_grants g JOIN chain c ON g.exchanged_from_grant_id = c.id)
  UPDATE token_grants g SET budget_grant_id = chain.root
    FROM chain
   WHERE g.id = chain.id AND chain.id <> chain.root AND g.budget_grant_id IS NULL;

  IF plain_owner THEN
    ALTER TABLE token_grants FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
