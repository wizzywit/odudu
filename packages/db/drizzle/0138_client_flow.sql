-- The sign-in flow a client runs, in place of the tenant's default one.
-- Null (every client starts so) follows the default. The pair
-- (tenant_id, flow_id) is the key, so a client cannot name another tenant's
-- flow whatever the application checks, and RESTRICT refuses deleting a flow
-- a client names. Deleting a tenant still works because its clients, and with
-- them their configuration, cascade away before its flows do. Every
-- statement can run again to no effect.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flows_tenant_id_id') THEN
    ALTER TABLE flows ADD CONSTRAINT flows_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE client_oidc_config ADD COLUMN IF NOT EXISTS flow_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_oidc_config_flow_fk') THEN
    ALTER TABLE client_oidc_config ADD CONSTRAINT client_oidc_config_flow_fk
      FOREIGN KEY (tenant_id, flow_id) REFERENCES flows (tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Finds the clients that name a flow: the refusal to delete one in use, and
-- the count the flow list shows. Holds only the clients that name one.
CREATE INDEX IF NOT EXISTS client_oidc_config_flow
  ON client_oidc_config (tenant_id, flow_id) WHERE flow_id IS NOT NULL;
