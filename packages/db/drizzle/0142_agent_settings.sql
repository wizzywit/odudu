-- Tenant limits of the agent identity layer: how deep a delegation may go,
-- how many live instances a tenant, a parent or a grant may hold, how long an
-- instance and an approval live, and how many writes a grant, or a window of a
-- grant's writes, may make. Constant defaults, so no row is rewritten.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS agent_max_delegation_depth integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS agent_max_children integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS agent_max_live_instances integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS agent_instance_ttl_seconds integer NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS agent_instance_idle_seconds integer NOT NULL DEFAULT 1800,
  ADD COLUMN IF NOT EXISTS agent_approval_ttl_seconds integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS agent_writes_per_grant integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS agent_creates_per_grant integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS agent_window_writes integer NOT NULL DEFAULT 1000;

DO $$
DECLARE
  bound record;
BEGIN
  FOR bound IN
    SELECT * FROM (VALUES
      ('agent_max_delegation_depth', 1, 8),
      ('agent_max_children', 1, 200),
      ('agent_max_live_instances', 1, 100000),
      ('agent_instance_ttl_seconds', 60, 86400),
      ('agent_instance_idle_seconds', 60, 86400),
      ('agent_approval_ttl_seconds', 60, 900),
      ('agent_writes_per_grant', 1, 1000),
      ('agent_creates_per_grant', 1, 1000),
      ('agent_window_writes', 1, 100000)
    ) AS v (col, lo, hi)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tenants_' || bound.col || '_range'
    ) THEN
      EXECUTE format(
        'ALTER TABLE tenants ADD CONSTRAINT %I CHECK (%I >= %s AND %I <= %s)',
        'tenants_' || bound.col || '_range', bound.col, bound.lo, bound.col, bound.hi
      );
    END IF;
  END LOOP;
END $$;
