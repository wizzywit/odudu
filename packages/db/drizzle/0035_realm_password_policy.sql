-- The weakest configuration this server is willing to call a policy: eight
-- characters and no class requirements. Every bound is a constraint rather
-- than a clamp, for the reason 0013 gives.
ALTER TABLE realms ADD COLUMN password_min_length integer NOT NULL DEFAULT 8;
ALTER TABLE realms ADD COLUMN password_require_digit boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_uppercase boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_lowercase boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_require_special boolean NOT NULL DEFAULT false;
ALTER TABLE realms ADD COLUMN password_not_username boolean NOT NULL DEFAULT true;
ALTER TABLE realms ADD COLUMN password_not_email boolean NOT NULL DEFAULT true;
ALTER TABLE realms ADD COLUMN password_history_depth integer NOT NULL DEFAULT 0;
ALTER TABLE realms ADD COLUMN password_max_age_days integer NOT NULL DEFAULT 0;

ALTER TABLE realms ADD CONSTRAINT realms_password_min_length_bounds
  CHECK (password_min_length BETWEEN 8 AND 256);
ALTER TABLE realms ADD CONSTRAINT realms_password_history_bounds
  CHECK (password_history_depth BETWEEN 0 AND 24);
ALTER TABLE realms ADD CONSTRAINT realms_password_max_age_bounds
  CHECK (password_max_age_days BETWEEN 0 AND 3650);
