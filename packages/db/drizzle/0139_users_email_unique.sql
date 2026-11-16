-- One address is one account whatever its case: a partial unique index on the
-- tenant and the lower-cased address. A database that still holds two accounts
-- differing only by case cannot build it, and a migration that failed there
-- would stop the server booting, so the build is skipped with a warning and
-- the start-up step builds it on the first boot after `odudu reconcile-accounts`
-- has folded the pairs. The build reads `users` once and blocks writes to it
-- while it does. It can run again to no effect.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_search_unique
    ON users (tenant_id, email_search) WHERE email_search IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'users_email_search_unique was not built: accounts that differ only by the case of their address exist; run odudu reconcile-accounts, and restart';
END $$;
