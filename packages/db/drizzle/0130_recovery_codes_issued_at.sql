-- When the subject's recovery set was last issued, which bounds how soon a
-- person may replace it. The set has no row of its own (it is the subject's
-- recovery-code credentials, replaced wholesale), so the marker lives on the
-- subject, whose row lock every issue already holds. Null until a set has
-- been issued; the table already carries its row-level policy.
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS recovery_codes_issued_at timestamptz;
