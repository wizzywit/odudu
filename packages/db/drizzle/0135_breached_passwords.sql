-- The two tenant settings of the breached-password check, and the dataset the
-- default source reads. The check defaults to the dataset and fails open, and
-- an empty dataset judges nothing breached, so no tenant's behaviour changes
-- until an operator loads one. IF NOT EXISTS so the file can run again to no
-- effect.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS breached_check text NOT NULL DEFAULT 'dataset',
  ADD COLUMN IF NOT EXISTS breached_on_error text NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_breached_check_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_breached_check_check
      CHECK (breached_check IN ('off', 'dataset', 'remote'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_breached_on_error_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_breached_on_error_check
      CHECK (breached_on_error IN ('open', 'closed'));
  END IF;
END $$;

-- SHA-1 of a password known from breaches, split as the public range lookup
-- splits it: five characters and the other thirty-five. Together they are the
-- whole hash of a password already published in the corpus the table is
-- loaded from, so the table is exactly as sensitive as that corpus and no
-- more. Global to the server, loaded by `odudu breached-passwords load`, not
-- per tenant: a corpus of hundreds of millions of rows cannot be copied into
-- every tenant. A lookup is one primary-key probe.
CREATE TABLE IF NOT EXISTS breached_password_hashes (
  prefix text NOT NULL,
  suffix text NOT NULL,
  PRIMARY KEY (prefix, suffix),
  CONSTRAINT breached_password_hashes_prefix_shape CHECK (prefix ~ '^[0-9A-F]{5}$'),
  CONSTRAINT breached_password_hashes_suffix_shape CHECK (suffix ~ '^[0-9A-F]{35}$')
);

-- Readable from inside any tenant's context and from nowhere else; the policy
-- names app.tenant_id so a read with none bound sees nothing. The serving role
-- never writes: the load runs as the owner, which escapes the policy.
ALTER TABLE breached_password_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE breached_password_hashes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS breached_password_hashes_read ON breached_password_hashes;
CREATE POLICY breached_password_hashes_read ON breached_password_hashes
  FOR SELECT
  USING (nullif(current_setting('app.tenant_id', true), '') IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON breached_password_hashes FROM odudu_app;
