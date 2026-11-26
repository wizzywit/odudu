-- A tenant's own choices for the console assistant, one row, written the first
-- time they change one; a tenant with no row has every default. The limits are
-- what the open entitlements read, so they are tenant settings and no price.
CREATE TABLE IF NOT EXISTS assistant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  assistant_enabled boolean NOT NULL DEFAULT true,
  assistant_default_mode text NOT NULL DEFAULT 'ask',
  assistant_mask_emails boolean NOT NULL DEFAULT false,
  assistant_trace_retention_days integer NOT NULL DEFAULT 30,
  assistant_auditor_visible boolean NOT NULL DEFAULT true,
  assistant_monthly_tokens_fast bigint NOT NULL DEFAULT 2000000,
  assistant_monthly_tokens_standard bigint NOT NULL DEFAULT 5000000,
  assistant_monthly_tokens_deep bigint NOT NULL DEFAULT 1000000,
  assistant_max_concurrent integer NOT NULL DEFAULT 5,
  assistant_max_steps_per_turn integer NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_settings_mode_check CHECK (assistant_default_mode IN ('ask', 'act')),
  CONSTRAINT assistant_settings_retention_range CHECK (
    assistant_trace_retention_days BETWEEN 1 AND 365
  ),
  CONSTRAINT assistant_settings_tokens_range CHECK (
    assistant_monthly_tokens_fast BETWEEN 0 AND 1000000000
    AND assistant_monthly_tokens_standard BETWEEN 0 AND 1000000000
    AND assistant_monthly_tokens_deep BETWEEN 0 AND 1000000000
  ),
  CONSTRAINT assistant_settings_concurrent_range CHECK (assistant_max_concurrent BETWEEN 1 AND 50),
  CONSTRAINT assistant_settings_steps_range CHECK (assistant_max_steps_per_turn BETWEEN 1 AND 100)
);

ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_settings_isolation ON assistant_settings;
CREATE POLICY assistant_settings_isolation ON assistant_settings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
