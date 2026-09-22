-- The GUC name is a string literal inside each policy's qualifier, and
-- ALTER TABLE ... RENAME does not rewrite it (the column reference it does):
-- docs/superpowers/rename-spike-postgres.md. So every policy is dropped and
-- recreated against app.tenant_id rather than carried over by the rename,
-- which would otherwise leave each one filtering on a setting nobody sets.

ALTER TABLE realms RENAME TO tenants;

ALTER TABLE action_tokens RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE authentication_executions RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE authentication_sessions RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE authorization_codes RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE backchannel_logout_deliveries RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_assertion_jti RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_oidc_config RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_registration_tokens RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_scope_assignments RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_scope_roles RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE client_scopes RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE clients RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE consent_scopes RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE consents RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE email_outbox RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE group_roles RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE groups RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE login_failures RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE refresh_tokens RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE role_composites RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE roles RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE sessions RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE signing_keys RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE subject_groups RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE subject_roles RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE subjects RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE token_grants RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE user_credentials RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE user_required_actions RENAME COLUMN realm_id TO tenant_id;
ALTER TABLE users RENAME COLUMN realm_id TO tenant_id;

DROP POLICY realms_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY action_tokens_isolation ON action_tokens;
CREATE POLICY action_tokens_isolation ON action_tokens
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY authentication_executions_isolation ON authentication_executions;
CREATE POLICY authentication_executions_isolation ON authentication_executions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY authentication_sessions_isolation ON authentication_sessions;
CREATE POLICY authentication_sessions_isolation ON authentication_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY authorization_codes_isolation ON authorization_codes;
CREATE POLICY authorization_codes_isolation ON authorization_codes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY backchannel_logout_deliveries_isolation ON backchannel_logout_deliveries;
CREATE POLICY backchannel_logout_deliveries_isolation ON backchannel_logout_deliveries
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_assertion_jti_isolation ON client_assertion_jti;
CREATE POLICY client_assertion_jti_isolation ON client_assertion_jti
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_oidc_config_isolation ON client_oidc_config;
CREATE POLICY client_oidc_config_isolation ON client_oidc_config
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_registration_tokens_isolation ON client_registration_tokens;
CREATE POLICY client_registration_tokens_isolation ON client_registration_tokens
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_scope_assignments_isolation ON client_scope_assignments;
CREATE POLICY client_scope_assignments_isolation ON client_scope_assignments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_scope_roles_isolation ON client_scope_roles;
CREATE POLICY client_scope_roles_isolation ON client_scope_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY client_scopes_isolation ON client_scopes;
CREATE POLICY client_scopes_isolation ON client_scopes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY clients_isolation ON clients;
CREATE POLICY clients_isolation ON clients
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY consent_scopes_isolation ON consent_scopes;
CREATE POLICY consent_scopes_isolation ON consent_scopes
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY consents_isolation ON consents;
CREATE POLICY consents_isolation ON consents
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY email_outbox_isolation ON email_outbox;
CREATE POLICY email_outbox_isolation ON email_outbox
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY group_roles_isolation ON group_roles;
CREATE POLICY group_roles_isolation ON group_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY groups_isolation ON groups;
CREATE POLICY groups_isolation ON groups
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY login_failures_isolation ON login_failures;
CREATE POLICY login_failures_isolation ON login_failures
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY refresh_tokens_isolation ON refresh_tokens;
CREATE POLICY refresh_tokens_isolation ON refresh_tokens
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY role_composites_isolation ON role_composites;
CREATE POLICY role_composites_isolation ON role_composites
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY roles_isolation ON roles;
CREATE POLICY roles_isolation ON roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY sessions_isolation ON sessions;
CREATE POLICY sessions_isolation ON sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY signing_keys_isolation ON signing_keys;
CREATE POLICY signing_keys_isolation ON signing_keys
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY subject_groups_isolation ON subject_groups;
CREATE POLICY subject_groups_isolation ON subject_groups
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY subject_roles_isolation ON subject_roles;
CREATE POLICY subject_roles_isolation ON subject_roles
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY subjects_isolation ON subjects;
CREATE POLICY subjects_isolation ON subjects
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY token_grants_isolation ON token_grants;
CREATE POLICY token_grants_isolation ON token_grants
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY user_credentials_isolation ON user_credentials;
CREATE POLICY user_credentials_isolation ON user_credentials
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY user_required_actions_isolation ON user_required_actions;
CREATE POLICY user_required_actions_isolation ON user_required_actions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY users_isolation ON users;
CREATE POLICY users_isolation ON users
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
