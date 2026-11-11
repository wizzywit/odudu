-- The required actions an application may start for a signed-in person
-- through /authorize: any of update-password, configure-totp,
-- configure-passkey, generate-recovery-codes. A constant default, so adding
-- the column rewrites no row and every client starts with none, and
-- IF NOT EXISTS so the statement can run again to no effect. The column sits
-- on a table that already carries its row-level policy, so it needs none of
-- its own.
ALTER TABLE client_oidc_config
  ADD COLUMN IF NOT EXISTS allowed_actions text[] NOT NULL DEFAULT '{}';
