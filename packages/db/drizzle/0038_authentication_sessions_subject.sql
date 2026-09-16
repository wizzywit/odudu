-- Which subject this attempt is about, once any factor has said so. Null
-- until then, because nothing has identified anyone yet. With two factors,
-- `satisfied` alone records that a password was accepted but not whose: the
-- second factor would otherwise decide the login's answer on its own, and a
-- code belonging to somebody else would finish somebody else's sign-in.
-- Cleared, with `satisfied`, when the attempt is refused in a way that
-- invites a different person to sign in against the same parked request.
ALTER TABLE authentication_sessions ADD COLUMN subject_id uuid;

ALTER TABLE authentication_sessions
  ADD CONSTRAINT authentication_sessions_subject_fk
  FOREIGN KEY (realm_id, subject_id) REFERENCES subjects (realm_id, id) ON DELETE CASCADE;
