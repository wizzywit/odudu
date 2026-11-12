-- Whether the tenant asks every person who signs in to hold a passkey. Off
-- changes nothing; on, a person without one is given the configure-passkey
-- required action at their next sign-in. A constant default, so adding the
-- column rewrites no row, and IF NOT EXISTS so the statement can run again.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS require_passkey boolean NOT NULL DEFAULT false;
