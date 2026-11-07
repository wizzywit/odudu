-- A fourth client registration policy: 'mcp' opens the registration endpoint
-- to public clients bound to the tenant's MCP endpoint, and nothing else.
-- The default stays 'disabled', so an existing tenant is unchanged.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_client_registration_policy_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_client_registration_policy_check
  CHECK (client_registration_policy IN ('disabled', 'open', 'token', 'mcp'));
