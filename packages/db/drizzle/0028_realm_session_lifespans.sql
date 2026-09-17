-- Bounds are constraints rather than clamps at the point of use, for the
-- reason 0013 gives: a constraint is true of every writer there will ever
-- be, including an admin API this repository does not have yet.
ALTER TABLE realms ADD COLUMN sso_session_idle_seconds integer NOT NULL DEFAULT 1800;
ALTER TABLE realms ADD COLUMN sso_session_max_seconds integer NOT NULL DEFAULT 36000;

ALTER TABLE realms ADD CONSTRAINT realms_sso_idle_bounds
  CHECK (sso_session_idle_seconds BETWEEN 60 AND 2592000);
ALTER TABLE realms ADD CONSTRAINT realms_sso_max_bounds
  CHECK (sso_session_max_seconds BETWEEN 60 AND 2592000);

-- An idle timeout longer than the ceiling is not a lenient configuration,
-- it is a meaningless one: the ceiling would always win and the idle number
-- would never be consulted.
ALTER TABLE realms ADD CONSTRAINT realms_sso_idle_within_max
  CHECK (sso_session_idle_seconds <= sso_session_max_seconds);
