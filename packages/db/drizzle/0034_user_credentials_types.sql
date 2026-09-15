-- A password and a TOTP secret are one per subject; passkeys and recovery
-- codes are many, which is why the old UNIQUE (subject_id, type) has to go
-- rather than be widened. password-history rows are retired hashes kept
-- for the realm's history depth and are never verified against for login.
--
-- 0005_subjects.sql named the old uniqueness constraint
-- user_credentials_one_password, not user_credentials_subject_id_type_unique
-- — there was never a second constraint by that name to drop.
ALTER TABLE user_credentials
  DROP CONSTRAINT user_credentials_one_password;

ALTER TABLE user_credentials DROP CONSTRAINT user_credentials_type_check;
ALTER TABLE user_credentials ADD CONSTRAINT user_credentials_type_check CHECK (
  type IN ('password', 'totp', 'webauthn', 'recovery-code', 'password-history')
);

-- Reversible: ALTER TABLE user_credentials ALTER COLUMN secret_data TYPE text
-- USING secret_data->>'hash' recovers the original PHC string byte-for-byte,
-- verified against every existing row shape before this migration was written.
ALTER TABLE user_credentials
  ALTER COLUMN secret_data TYPE jsonb
  USING jsonb_build_object('hash', secret_data);

ALTER TABLE user_credentials ADD COLUMN label text;
ALTER TABLE user_credentials ADD COLUMN last_used_at timestamptz;
ALTER TABLE user_credentials ADD COLUMN lookup_key text;

CREATE UNIQUE INDEX user_credentials_one_password
  ON user_credentials (subject_id) WHERE type = 'password';
CREATE UNIQUE INDEX user_credentials_one_totp
  ON user_credentials (subject_id) WHERE type = 'totp';

-- A passwordless assertion arrives naming a credential, not a user, so the
-- subject is resolved through this index rather than by scanning jsonb
-- across a realm.
CREATE UNIQUE INDEX user_credentials_lookup_key
  ON user_credentials (realm_id, lookup_key) WHERE lookup_key IS NOT NULL;
