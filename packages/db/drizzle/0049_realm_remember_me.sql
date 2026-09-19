-- A realm may offer "remember me"; a login that takes it is measured
-- against this pair instead of sso_session_*. The ranges and the
-- idle <= max rule are CHECK constraints for the same reason 0028's are:
-- a policy no writer may bypass belongs at the database.
ALTER TABLE realms ADD COLUMN remember_me_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN remember_me_idle_seconds integer NOT NULL DEFAULT 604800;
ALTER TABLE realms ADD COLUMN remember_me_max_seconds integer NOT NULL DEFAULT 2592000;

ALTER TABLE realms ADD CONSTRAINT realms_remember_me_idle_range
  CHECK (remember_me_idle_seconds BETWEEN 60 AND 31536000);
ALTER TABLE realms ADD CONSTRAINT realms_remember_me_max_range
  CHECK (remember_me_max_seconds BETWEEN 60 AND 31536000);
ALTER TABLE realms ADD CONSTRAINT realms_remember_me_idle_within_max
  CHECK (remember_me_idle_seconds <= remember_me_max_seconds);
