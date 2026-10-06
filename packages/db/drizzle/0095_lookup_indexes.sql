-- Reads and cascades that found their rows by a column nothing indexed, so
-- each one read a tenant's whole table: a subject's credentials, sessions
-- and grants, a client's sessions, who a service subject is, which rows an
-- actor wrote, which subjects are locked, every flag-selected subset, and
-- the rows a deleted subject, client, role, group, scope or grant owns.

CREATE INDEX user_credentials_by_subject ON user_credentials (subject_id, type);
CREATE INDEX sessions_by_subject ON sessions (subject_id, id);
CREATE INDEX token_grants_by_subject ON token_grants (subject_id, id);
CREATE INDEX token_grants_by_client ON token_grants (client_id, session_id);
CREATE INDEX token_grants_by_actor ON token_grants (actor_subject_id)
  WHERE actor_subject_id IS NOT NULL;
CREATE INDEX token_grants_by_exchanged_from ON token_grants (exchanged_from_grant_id)
  WHERE exchanged_from_grant_id IS NOT NULL;
CREATE INDEX action_tokens_by_subject ON action_tokens (subject_id);
CREATE INDEX authorization_codes_by_client ON authorization_codes (client_id);
CREATE INDEX authorization_codes_by_subject ON authorization_codes (subject_id);
CREATE INDEX authentication_sessions_by_subject ON authentication_sessions (subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX consents_by_client ON consents (client_id);
CREATE INDEX consent_scopes_by_scope ON consent_scopes (client_scope_id);
CREATE INDEX client_scope_assignments_by_scope ON client_scope_assignments (client_scope_id, client_id);
CREATE INDEX role_composites_by_child ON role_composites (child_role_id);
CREATE INDEX client_scope_roles_by_role ON client_scope_roles (role_id);
CREATE INDEX group_roles_by_role ON group_roles (role_id);
CREATE INDEX client_registration_tokens_by_expiry ON client_registration_tokens (tenant_id, expires_at);
CREATE INDEX console_sessions_by_expiry ON console_sessions (tenant_id, expires_at);
CREATE INDEX console_sessions_by_subject ON console_sessions (subject_id);
CREATE INDEX console_logins_by_expiry ON console_logins (tenant_id, expires_at);

CREATE INDEX clients_by_service_subject ON clients (service_subject_id)
  WHERE service_subject_id IS NOT NULL;
CREATE INDEX clients_by_enabled ON clients (tenant_id, enabled, id);
CREATE INDEX tenants_by_enabled ON tenants (enabled, id);
CREATE INDEX roles_by_default ON roles (tenant_id, default_for_new_subjects, id);
CREATE INDEX groups_by_default ON groups (tenant_id, default_for_new_subjects, id);
CREATE INDEX login_failures_locked ON login_failures (tenant_id, locked_until)
  WHERE locked_until IS NOT NULL;

-- The listing orders on (occurred_at DESC, id DESC), so each filter's index
-- ends in that order and a page stops at LIMIT whatever the filter selects.
CREATE INDEX audit_events_actor
  ON audit_events (tenant_id, actor_subject_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_action
  ON audit_events (tenant_id, action, occurred_at DESC, id DESC);
CREATE INDEX audit_events_type
  ON audit_events (tenant_id, event_type, occurred_at DESC, id DESC);
CREATE INDEX audit_events_outcome
  ON audit_events (tenant_id, outcome, occurred_at DESC, id DESC);
CREATE INDEX client_oidc_config_by_tenant ON client_oidc_config (tenant_id, client_id);
CREATE INDEX client_registration_tokens_spent ON client_registration_tokens (tenant_id, created_at)
  WHERE remaining_uses = 0;
CREATE INDEX console_sessions_by_seen ON console_sessions (tenant_id, last_seen_at);
