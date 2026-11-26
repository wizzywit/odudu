-- The tenant a console assistant conversation acts in, when it is not the
-- tenant its owner belongs to: a system administrator using the assistant in
-- another tenant. Null means the owner's own tenant, which is every row until
-- now. The rows themselves stay in the owner's tenant (tenant_id), so every
-- composite key to the subject, the session and the grant still holds; only
-- the admin API's door reads the target, from the grant, and honours it for
-- the built-in assistant client alone. It is never equal to tenant_id: a
-- conversation in its own tenant is the null case. Deleting the target tenant
-- deletes what was made for it. The partial indexes serve that cascade and a
-- filter by target without a scan of the large token_grants table, where the
-- column is null for nearly every row.
ALTER TABLE assistant_conversations
  ADD COLUMN IF NOT EXISTS target_tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE;
ALTER TABLE token_grants
  ADD COLUMN IF NOT EXISTS target_tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assistant_conversations_target_not_home'
  ) THEN
    ALTER TABLE assistant_conversations
      ADD CONSTRAINT assistant_conversations_target_not_home
      CHECK (target_tenant_id IS NULL OR target_tenant_id <> tenant_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'token_grants_target_not_home'
  ) THEN
    ALTER TABLE token_grants
      ADD CONSTRAINT token_grants_target_not_home
      CHECK (target_tenant_id IS NULL OR target_tenant_id <> tenant_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assistant_conversations_target
  ON assistant_conversations (target_tenant_id, tenant_id) WHERE target_tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS token_grants_target
  ON token_grants (target_tenant_id, tenant_id) WHERE target_tenant_id IS NOT NULL;
