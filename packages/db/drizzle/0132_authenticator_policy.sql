-- What a tenant asks of the authenticators a person enrols from now on: the
-- algorithm, digits and period of a TOTP, whether a passkey is made with user
-- verification and a resident key, and how many recovery codes a set holds.
-- Constant defaults, so adding the columns rewrites no row, and IF NOT EXISTS
-- so the statements can run again to no effect. The defaults are what every
-- enrolment has been made with until now.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS totp_algorithm text NOT NULL DEFAULT 'SHA1',
  ADD COLUMN IF NOT EXISTS totp_digits integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS totp_period integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS webauthn_user_verification text NOT NULL DEFAULT 'required',
  ADD COLUMN IF NOT EXISTS webauthn_resident_key text NOT NULL DEFAULT 'required',
  ADD COLUMN IF NOT EXISTS recovery_code_count integer NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_totp_algorithm_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_totp_algorithm_check
      CHECK (totp_algorithm IN ('SHA1', 'SHA256', 'SHA512'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_totp_digits_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_totp_digits_check
      CHECK (totp_digits IN (6, 8));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_totp_period_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_totp_period_check
      CHECK (totp_period IN (30, 60));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_webauthn_user_verification_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_webauthn_user_verification_check
      CHECK (webauthn_user_verification IN ('required', 'preferred', 'discouraged'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_webauthn_resident_key_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_webauthn_resident_key_check
      CHECK (webauthn_resident_key IN ('required', 'preferred', 'discouraged'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_recovery_code_count_range') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_recovery_code_count_range
      CHECK (recovery_code_count >= 8 AND recovery_code_count <= 16);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_recovery_warn_within_count'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_recovery_warn_within_count
      CHECK (recovery_code_warn_below <= recovery_code_count);
  END IF;
END $$;

-- Each enrolment keeps the parameters it was made under, so a later change of
-- the tenant's policy cannot change how it verifies. A TOTP row already holds
-- its digits; the algorithm and period were never stored and were always SHA1
-- and 30 seconds. A passkey was always made with user verification and a
-- resident key required. Only a key a row lacks is written, so the file can
-- run again to no effect, and a row already carrying a value keeps it.
-- user_credentials forces row security: for a migrating role that is neither
-- SUPERUSER nor BYPASSRLS (which a supported install never is, ADR 0009) it
-- is lifted for the statements and put back, as in 0119.
DO $$
DECLARE
  plain_owner boolean;
BEGIN
  SELECT NOT (rolsuper OR rolbypassrls) INTO plain_owner FROM pg_roles WHERE rolname = current_user;
  IF plain_owner THEN
    ALTER TABLE user_credentials NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE user_credentials
     SET secret_data = jsonb_build_object('algorithm', 'SHA1', 'period', 30) || secret_data
   WHERE type = 'totp' AND NOT (secret_data ? 'algorithm' AND secret_data ? 'period');

  UPDATE user_credentials
     SET secret_data =
       jsonb_build_object('userVerification', 'required', 'residentKey', 'required') || secret_data
   WHERE type = 'webauthn' AND NOT (secret_data ? 'userVerification' AND secret_data ? 'residentKey');

  IF plain_owner THEN
    ALTER TABLE user_credentials FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
