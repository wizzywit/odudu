-- Keyed by subject, not by username: a lockout that followed a username
-- would let an attacker lock an account out of existence by guessing at a
-- name it no longer uses, and would miss an attacker arriving by email.
CREATE TABLE login_failures (
  realm_id uuid NOT NULL REFERENCES realms (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  first_failure_at timestamptz,
  last_failure_at timestamptz,
  locked_until timestamptz,
  PRIMARY KEY (realm_id, subject_id),
  CONSTRAINT login_failures_subject_fk
    FOREIGN KEY (realm_id, subject_id) REFERENCES subjects (realm_id, id) ON DELETE CASCADE
);

ALTER TABLE login_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_failures FORCE ROW LEVEL SECURITY;

CREATE POLICY login_failures_isolation ON login_failures
  USING (realm_id = nullif(current_setting('app.realm_id', true), '')::uuid);

-- On by default, unlike every other realm switch this phase adds. RFC 6749
-- §2.3.1's brute-force protection is a MUST, and a MUST that ships off is
-- not held.
ALTER TABLE realms ADD COLUMN brute_force_max_failures integer NOT NULL DEFAULT 5;
ALTER TABLE realms ADD COLUMN brute_force_lockout_seconds integer NOT NULL DEFAULT 60;
ALTER TABLE realms ADD COLUMN brute_force_max_lockout_seconds integer NOT NULL DEFAULT 900;
ALTER TABLE realms ADD COLUMN brute_force_failure_reset_seconds integer NOT NULL DEFAULT 43200;

ALTER TABLE realms ADD CONSTRAINT realms_brute_force_bounds CHECK (
  brute_force_max_failures BETWEEN 1 AND 100
  AND brute_force_lockout_seconds BETWEEN 1 AND 86400
  AND brute_force_max_lockout_seconds >= brute_force_lockout_seconds
  AND brute_force_failure_reset_seconds BETWEEN 60 AND 2592000
);
