-- When every factor this realm's flow asks of the bound subject had been
-- satisfied; null while any remains. `subject_id` alone is written by the
-- *first* factor, so without this a password is enough to satisfy a required
-- action — and one of those actions prints ten recovery codes that stand in
-- for the second factor. Rewritten on every attempt that gets past the
-- subject binding, because enrolling a factor can make a step apply that did
-- not before, and cleared with `satisfied` and `subject_id` when the attempt
-- is refused in a way that invites somebody else to sign in.
ALTER TABLE authentication_sessions ADD COLUMN authenticated_at timestamptz;
