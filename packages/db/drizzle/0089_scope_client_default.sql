-- Whether a client created afterwards is assigned this scope, and how: what
-- was a list of names in the code that provisions a client is now each
-- tenant's own. NULL leaves the scope to be assigned deliberately.
ALTER TABLE client_scopes ADD COLUMN default_client_assignment text;
ALTER TABLE client_scopes ADD CONSTRAINT client_scopes_default_client_assignment_check
  CHECK (default_client_assignment IN ('default', 'optional'));

-- Every tenant's existing scopes of those names keep giving a new client what
-- they gave it before. FORCE ROW LEVEL SECURITY is lifted around the rewrite
-- and restored, as 0040_recovery_code_execution.sql does and explains.
ALTER TABLE client_scopes NO FORCE ROW LEVEL SECURITY;
UPDATE client_scopes SET default_client_assignment = 'default'
 WHERE name IN ('openid', 'profile', 'email', 'address', 'phone', 'roles', 'groups');
UPDATE client_scopes SET default_client_assignment = 'optional'
 WHERE name = 'offline_access';
ALTER TABLE client_scopes FORCE ROW LEVEL SECURITY;
