-- A tenant's sign-in flows: an ordered list of steps held as one row. Every
-- tenant has exactly one default flow, which replaces the per-tenant rows of
-- authentication_executions; each tenant's default is backfilled from its
-- rows (a tenant with none gets the flow a new tenant is provisioned with),
-- and the old table is dropped. A sign-in in flight is not affected: the
-- authentication session records what it satisfied by authenticator name
-- (0032), never by an execution id.
CREATE TABLE IF NOT EXISTS flows (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  steps jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flows_name_length CHECK (char_length(name) BETWEEN 1 AND 64),
  CONSTRAINT flows_steps_bounded CHECK (
    jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 20
  ),
  -- Also the index behind a tenant's flow list, ordered by name.
  CONSTRAINT flows_tenant_name UNIQUE (tenant_id, name)
);

-- At most one default per tenant, and the index the sign-in read finds it by.
CREATE UNIQUE INDEX IF NOT EXISTS flows_one_default ON flows (tenant_id) WHERE is_default;

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flows_isolation ON flows;
CREATE POLICY flows_isolation ON flows
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The backfill runs only while the old table exists, so the file can run
-- again to no effect. When the migrating role is neither SUPERUSER nor
-- BYPASSRLS, which a supported install never is (ADR 0009), FORCE ROW LEVEL
-- SECURITY is lifted around it, on tenants and authentication_executions too
-- because the insert reads both, and restored, as 0125_me_scopes.sql does.
DO $$
DECLARE
  exempt boolean;
BEGIN
  IF to_regclass('authentication_executions') IS NULL THEN
    RETURN;
  END IF;
  SELECT rolsuper OR rolbypassrls INTO exempt FROM pg_roles WHERE rolname = current_user;
  IF NOT exempt THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE authentication_executions NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE flows NO FORCE ROW LEVEL SECURITY;
  END IF;

  INSERT INTO flows (id, tenant_id, name, is_default, steps)
  SELECT gen_random_uuid(), t.id, 'default', true,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('authenticator', e.authenticator,
                                   'requirement', e.requirement)
                ORDER BY e.index)
         FROM authentication_executions e
        WHERE e.tenant_id = t.id),
      '[{"authenticator": "passkey", "requirement": "alternative"},
        {"authenticator": "password", "requirement": "alternative"},
        {"authenticator": "otp", "requirement": "conditional"},
        {"authenticator": "recovery-code", "requirement": "conditional"}]'::jsonb)
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM flows f WHERE f.tenant_id = t.id AND f.is_default);

  IF NOT exempt THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
    ALTER TABLE flows FORCE ROW LEVEL SECURITY;
  END IF;
  DROP TABLE authentication_executions;
END $$;
