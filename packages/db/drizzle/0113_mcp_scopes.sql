-- The two scopes an MCP client asks for, in every tenant that exists now; a
-- tenant created later has them from provisioning. Neither is marked for new
-- clients, and what a person reads at consent is the page catalogue's. A tenant
-- that already has a scope of the name keeps it as it is, so the statement can
-- run again to no effect. FORCE ROW LEVEL SECURITY is lifted around the insert
-- and restored, as 0089_scope_client_default.sql does.
ALTER TABLE client_scopes NO FORCE ROW LEVEL SECURITY;
INSERT INTO client_scopes
  (id, tenant_id, name, description, include_in_id_token, include_in_access_token)
SELECT gen_random_uuid(), t.id, s.name, s.description, false, true
  FROM tenants t
 CROSS JOIN (VALUES
  ('mcp:read',
   'Read the tenant through an MCP client: its settings and records, nothing changed.'),
  ('mcp:write',
   'Change the tenant through an MCP client, with a short-lived access token.')
 ) AS s (name, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM client_scopes c WHERE c.tenant_id = t.id AND c.name = s.name);
ALTER TABLE client_scopes FORCE ROW LEVEL SECURITY;
