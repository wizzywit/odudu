-- The share of a delegation's write budget an instance may spend: the limits
-- it was minted with and what it has spent so far. A nested instance is
-- minted with what its parent had left. Existing instances take the tenant
-- defaults, which no row can have overspent since none counted before.
-- A daily window may hold up to the tenant's cap of 100000, past smallint.
ALTER TABLE agent_instances
  ADD COLUMN IF NOT EXISTS slice_mutating integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS slice_creates integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS spent_mutating integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spent_creates integer NOT NULL DEFAULT 0;

ALTER TABLE agent_budget_windows ALTER COLUMN writes TYPE integer;

DO $$
DECLARE
  rule record;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('agent_instances', 'agent_instances_slice_mutating_range', 'slice_mutating >= 0'),
      ('agent_instances', 'agent_instances_slice_creates_range', 'slice_creates >= 0'),
      ('agent_instances', 'agent_instances_spent_mutating_within_slice',
        'spent_mutating >= 0 AND spent_mutating <= slice_mutating'),
      ('agent_instances', 'agent_instances_spent_creates_within_slice',
        'spent_creates >= 0 AND spent_creates <= slice_creates'),
      ('agent_budget_windows', 'agent_budget_windows_writes_range', 'writes >= 0')
    ) AS v (tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = rule.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', rule.tbl, rule.name, rule.expr);
    END IF;
  END LOOP;
END $$;
