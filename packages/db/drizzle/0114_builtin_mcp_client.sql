-- The built-in `odudu-mcp` public client every tenant is provisioned with
-- (provisionMcpClient, @odudu/protocol-oidc), added to every tenant that
-- exists now. `builtin_mcp` marks it, at most once a tenant, so a client that
-- merely carries the id is never mistaken for it: a tenant that already has one
-- is skipped and keeps it as it is. Each statement writes only what is
-- missing, so the file can run again to no effect. FORCE ROW LEVEL SECURITY is
-- lifted around the inserts and restored, as 0113_mcp_scopes.sql does.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS builtin_mcp boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS clients_one_builtin_mcp ON clients (tenant_id) WHERE builtin_mcp;

ALTER TABLE clients NO FORCE ROW LEVEL SECURITY;
ALTER TABLE client_oidc_config NO FORCE ROW LEVEL SECURITY;
ALTER TABLE client_scope_assignments NO FORCE ROW LEVEL SECURITY;

INSERT INTO clients (id, tenant_id, client_id, name, type, secret_hash, builtin_mcp)
SELECT gen_random_uuid(), t.id, 'odudu-mcp', 'Odudu MCP', 'public', NULL, true
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM clients c WHERE c.tenant_id = t.id AND c.client_id = 'odudu-mcp');

INSERT INTO client_oidc_config
  (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method,
   audiences, access_token_ttl_seconds, id_token_ttl_seconds,
   refresh_token_ttl_seconds, consent_required)
SELECT c.id, c.tenant_id, ARRAY['http://127.0.0.1', 'http://[::1]'],
       ARRAY['authorization_code', 'refresh_token'], 'none',
       ARRAY['urn:odudu:params:admin-api'], 300, 300, 1209600, true
  FROM clients c
 WHERE c.builtin_mcp
   AND NOT EXISTS (SELECT 1 FROM client_oidc_config o WHERE o.client_id = c.id);

INSERT INTO client_scope_assignments (tenant_id, client_id, client_scope_id, assignment)
SELECT c.tenant_id, c.id, s.id,
       CASE WHEN s.name = 'mcp:write' THEN 'optional'
            WHEN s.name = 'mcp:read' THEN 'default'
            ELSE s.default_client_assignment END
  FROM clients c
  JOIN client_scopes s ON s.tenant_id = c.tenant_id
 WHERE c.builtin_mcp
   AND (s.name IN ('mcp:read', 'mcp:write') OR s.default_client_assignment IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM client_scope_assignments a WHERE a.client_id = c.id);

ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE client_oidc_config FORCE ROW LEVEL SECURITY;
ALTER TABLE client_scope_assignments FORCE ROW LEVEL SECURITY;
