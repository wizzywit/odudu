-- The built-in `odudu-assistant` client the console assistant's conversations
-- act as (provisionAssistantClient, @odudu/protocol-oidc), added to every
-- tenant that exists now. `builtin_assistant` marks it, at most once a tenant,
-- so a client that merely carries the id is never mistaken for it: a tenant
-- that already has one is skipped and keeps it as it is. It registers no
-- redirect URI and holds `client_credentials` alone, which a public client is
-- refused, so no protocol endpoint can issue anything to it. Each statement
-- writes only what is missing, so the file can run again to no effect. FORCE
-- ROW LEVEL SECURITY is lifted around the inserts and restored, only for a
-- migrating role that is neither SUPERUSER nor BYPASSRLS, as
-- 0114_builtin_mcp_client.sql does.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS builtin_assistant boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS clients_one_builtin_assistant
  ON clients (tenant_id) WHERE builtin_assistant;

DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE clients NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE client_oidc_config NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

INSERT INTO clients (id, tenant_id, client_id, name, type, secret_hash, builtin_assistant)
SELECT gen_random_uuid(), t.id, 'odudu-assistant', 'Odudu assistant', 'public', NULL, true
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM clients c WHERE c.tenant_id = t.id AND c.client_id = 'odudu-assistant');

INSERT INTO client_oidc_config
  (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method,
   audiences, access_token_ttl_seconds, id_token_ttl_seconds,
   refresh_token_ttl_seconds, agent_type)
SELECT c.id, c.tenant_id, ARRAY[]::text[], ARRAY['client_credentials'], 'none',
       ARRAY['urn:odudu:params:admin-api'], 300, 300, 300, true
  FROM clients c
 WHERE c.builtin_assistant
   AND NOT EXISTS (SELECT 1 FROM client_oidc_config o WHERE o.client_id = c.id);

DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
    ALTER TABLE clients FORCE ROW LEVEL SECURITY;
    ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
