-- All three default off: a realm does not acquire a public registration
-- endpoint because it was upgraded.
ALTER TABLE realms
  ADD COLUMN registration_allowed   boolean NOT NULL DEFAULT false,
  ADD COLUMN verify_email           boolean NOT NULL DEFAULT false,
  ADD COLUMN reset_password_allowed boolean NOT NULL DEFAULT false;
