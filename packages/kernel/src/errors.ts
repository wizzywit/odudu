export type ErrorCode =
  | 'config_invalid'
  | 'module_duplicate'
  | 'module_unknown_dependency'
  | 'module_cycle'
  | 'module_stop_failed'
  | 'tenant_context_missing'
  | 'kek_invalid'
  | 'signing_key_not_found'
  | 'jwt_header_invalid'
  | 'jwt_kid_missing'
  | 'jwt_unknown_key'
  | 'jwt_alg_mismatch'
  | 'jwt_typ_mismatch'
  | 'jwe_alg_unsupported'
  | 'claim_mapper_duplicate'
  | 'invalid_email'
  | 'seed_invalid_options'
  | 'seed_conflict'
  | 'seed_not_found'
  | 'seed_unknown_command'
  | 'seed_unknown_setting'
  | 'seed_unknown_grant_type'
  | 'seed_admin_exists'
  | 'seed_system_tenant_conflict'
  | 'admin_client_not_builtin'
  | 'insert_returned_no_row'
  | 'role_not_found'
  | 'role_composite_cycle'
  | 'group_not_found'
  | 'group_reparent_cycle'
  | 'client_scope_not_found'
  | 'user_not_found'
  | 'subject_not_found'
  | 'credential_not_found'
  | 'tenant_not_found'
  | 'reap_cannot_enumerate_tenants'
  | 'reap_requires_app_database_url'
  | 'reap_serving_role_bypasses_rls'
  | 'outbox_cannot_enumerate_tenants'
  | 'outbox_requires_app_database_url'
  | 'outbox_serving_role_bypasses_rls'
  | 'logout_sender_cannot_enumerate_tenants'
  | 'logout_sender_requires_app_database_url'
  | 'logout_sender_serving_role_bypasses_rls';

export class OduduError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OduduError';
    this.code = code;
  }
}
