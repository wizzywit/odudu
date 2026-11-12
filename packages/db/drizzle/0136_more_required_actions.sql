-- The terms a tenant asks people to accept, the three required actions that
-- ask for more of a person (verify-email, update-profile, accept-terms), and
-- the record of an acceptance. Every statement can run again to no effect.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS terms_uri text,
  ADD COLUMN IF NOT EXISTS terms_version text NOT NULL DEFAULT '1';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_terms_version_length') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_terms_version_length
      CHECK (char_length(terms_version) BETWEEN 1 AND 64);
  END IF;
END $$;

-- The vocabulary of required actions, widened by the three, in the database
-- too. A client may start the two that are not the tenant's own.
ALTER TABLE user_required_actions DROP CONSTRAINT IF EXISTS user_required_actions_action;
ALTER TABLE user_required_actions ADD CONSTRAINT user_required_actions_action CHECK (
  action IN ('verify-email', 'update-password', 'configure-totp', 'configure-passkey',
             'generate-recovery-codes', 'update-profile', 'accept-terms')
);

ALTER TABLE client_oidc_config DROP CONSTRAINT IF EXISTS client_oidc_config_allowed_actions_check;
ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_allowed_actions_check
  CHECK (allowed_actions <@ ARRAY[
    'verify-email', 'update-password', 'configure-totp', 'configure-passkey',
    'generate-recovery-codes', 'update-profile'
  ]);

-- The version of the tenant's terms a subject accepted, and when. One row per
-- subject and version, found by the primary key. Deleted with the subject.
CREATE TABLE IF NOT EXISTS subject_terms_acceptances (
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL,
  version     text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id, version),
  CONSTRAINT subject_terms_acceptances_subject_fk
    FOREIGN KEY (tenant_id, subject_id) REFERENCES subjects (tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE subject_terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_terms_acceptances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subject_terms_acceptances_isolation ON subject_terms_acceptances;
CREATE POLICY subject_terms_acceptances_isolation ON subject_terms_acceptances
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
