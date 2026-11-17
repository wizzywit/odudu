-- How few unspent recovery codes a person may hold before they are told to
-- issue a new set. A constant default, so adding the column rewrites no row,
-- and IF NOT EXISTS so the statement can run again to no effect. Zero turns
-- the warning off; ten is the size of a set, so a higher value would warn
-- about a set nobody has touched.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS recovery_code_warn_below integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_recovery_code_warn_below_range'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_recovery_code_warn_below_range
      CHECK (recovery_code_warn_below >= 0 AND recovery_code_warn_below <= 10);
  END IF;
END $$;
