import { z } from 'zod';
import { clientTypeSchema, registrationOriginSchema } from '#/admin/clients';
import { executionRequirementSchema } from '#/admin/flow';
import { profileSchema } from '#/admin/profile';
import { clientScopeAssignmentSchema } from '#/admin/scopes';
import { ASSIGNMENT_LIMIT, fieldErrorSchema, type FieldError } from '#/admin/shared';
import { requiredActionSchema } from '#/admin/subjects';
import { tenantSchema } from '#/admin/tenants';

// Above this many subjects `?include=subjects` is refused rather than
// answered: moving users in bulk is inbound provisioning's job, not a
// single response body's.
export const EXPORT_SUBJECT_CAP = 10_000;

// Above these a tenant's clients, roles or groups, and the links between
// them, are too many for one document: it is read whole, held whole and
// answered whole. The first is twice the design volume of clients in a tenant.
export const EXPORT_COLLECTION_CAP = 20_000;
export const EXPORT_LINK_CAP = 10 * EXPORT_COLLECTION_CAP;

export const TENANT_DOCUMENT_MEDIA_TYPE = 'application/vnd.odudu.tenant+json';

export const exportTenantQuerySchema = z.strictObject({
  include: z.literal('subjects').optional(),
});
export type ExportTenantQuery = z.infer<typeof exportTenantQuerySchema>;

// Every reference in the document is by name, never by row id, so a
// document means the same thing in whichever tenant it is imported into.
// A role is named with the `client_id` it belongs to, `null` for a tenant
// role: two roles may share a name when their clients differ.
export const roleReferenceSchema = z.strictObject({
  name: z.string(),
  client: z.string().nullable(),
});
export type RoleReference = z.infer<typeof roleReferenceSchema>;

const count = z.number().int();

// Every tenant setting except the three under `registration_policy`, by the
// name and type `@odudu/domain-tenant`'s SETTINGS gives it — held to that
// map by tenant-document-settings-parity.test.ts in @odudu/protocol-admin,
// since this package may not import it.
export const tenantSettingsDocumentSchema = z.strictObject({
  display_name: z.string().nullable(),
  enabled: z.boolean(),
  reset_password_allowed: z.boolean(),
  sso_session_idle_seconds: count,
  sso_session_max_seconds: count,
  password_min_length: count,
  password_require_digit: z.boolean(),
  password_require_uppercase: z.boolean(),
  password_require_lowercase: z.boolean(),
  password_require_special: z.boolean(),
  password_not_username: z.boolean(),
  password_not_email: z.boolean(),
  password_history_depth: count,
  password_max_age_days: count,
  otp_required: z.boolean(),
  brute_force_max_failures: count,
  brute_force_lockout_seconds: count,
  brute_force_max_lockout_seconds: count,
  brute_force_failure_reset_seconds: count,
  max_clients: count,
  max_sessions_per_browser: count,
  remember_me_allowed: z.boolean(),
  remember_me_idle_seconds: count,
  remember_me_max_seconds: count,
  audit_retention_days: count,
  username_editable: z.boolean(),
  access_token_ttl_seconds: count,
  id_token_ttl_seconds: count,
  refresh_token_ttl_seconds: count,
  authorization_code_ttl_seconds: count,
  login_ttl_seconds: count,
  verify_email_ttl_seconds: count,
  reset_password_ttl_seconds: count,
  login_with_email: z.boolean(),
  audit_event_types: z.array(z.string()),
});
export type TenantSettingsDocument = z.infer<typeof tenantSettingsDocumentSchema>;

export const registrationPolicySchema = z.strictObject({
  registration_allowed: z.boolean(),
  verify_email: z.boolean(),
  client_registration_policy: z.enum(['disabled', 'open', 'token']),
});
export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>;

export const REGISTRATION_POLICY_SETTINGS: readonly string[] =
  registrationPolicySchema.keyof().options;

export const exportedFlowStepSchema = z.strictObject({
  authenticator: z.string(),
  requirement: executionRequirementSchema,
});

export const exportedClientSchema = z.strictObject({
  client_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: clientTypeSchema,
  enabled: z.boolean(),
  full_scope_allowed: z.boolean(),
  registration_origin: registrationOriginSchema,
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  audiences: z.array(z.string()),
  access_token_ttl_seconds: z.number().int().nullable(),
  id_token_ttl_seconds: z.number().int().nullable(),
  refresh_token_ttl_seconds: z.number().int().nullable(),
  client_credentials_scopes: z.array(z.string()),
  web_origins: z.array(z.string()),
  post_logout_redirect_uris: z.array(z.string()),
  jwks: z.unknown().nullable(),
  jwks_uri: z.string().nullable(),
  frontchannel_logout_uri: z.string().nullable(),
  backchannel_logout_uri: z.string().nullable(),
  frontchannel_logout_session_required: z.boolean(),
  backchannel_logout_session_required: z.boolean(),
  consent_required: z.boolean(),
  token_exchange_impersonation_allowed: z.boolean(),
  userinfo_signed_response_alg: z.string().nullable(),
  userinfo_encrypted_response_alg: z.string().nullable(),
  userinfo_encrypted_response_enc: z.string().nullable(),
  tls_client_auth_subject_dn: z.string().nullable(),
  client_uri: z.string().nullable(),
  policy_uri: z.string().nullable(),
  tos_uri: z.string().nullable(),
  id_token_signed_response_alg: z.string().nullable(),
  default_max_age: z.number().int().nullable(),
  require_auth_time: z.boolean(),
  // The roles a confidential client's own service account holds, which
  // its client_credentials tokens carry; empty for a public client.
  service_account_roles: z.array(roleReferenceSchema).max(ASSIGNMENT_LIMIT),
});
export type ExportedClient = z.infer<typeof exportedClientSchema>;

// `builtin` marks what creating a tenant provisions by itself — the
// capability roles on `odudu-admin` and the default scopes — so an import
// can merge onto them rather than create a second copy.
export const exportedRoleSchema = z.strictObject({
  name: z.string(),
  client: z.string().nullable(),
  description: z.string().nullable(),
  default_for_new_subjects: z.boolean(),
  builtin: z.boolean(),
  composites: z.array(roleReferenceSchema).max(ASSIGNMENT_LIMIT),
});
export type ExportedRole = z.infer<typeof exportedRoleSchema>;

export const exportedGroupSchema = z.strictObject({
  path: z.string(),
  description: z.string().nullable(),
  default_for_new_subjects: z.boolean(),
  roles: z.array(roleReferenceSchema).max(ASSIGNMENT_LIMIT),
});
export type ExportedGroup = z.infer<typeof exportedGroupSchema>;

export const exportedScopeSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullable(),
  include_in_id_token: z.boolean(),
  include_in_access_token: z.boolean(),
  default_client_assignment: clientScopeAssignmentSchema.nullable(),
  consent_text: z.string().nullable(),
  display_order: z.number().int(),
  builtin: z.boolean(),
  roles: z.array(roleReferenceSchema).max(ASSIGNMENT_LIMIT),
  mappers: z.array(z.string()),
  clients: z.array(
    z.strictObject({ client_id: z.string(), assignment: clientScopeAssignmentSchema }),
  ),
});
export type ExportedScope = z.infer<typeof exportedScopeSchema>;

export const exportedSmtpSchema = z.strictObject({
  host: z.string(),
  port: z.number().int(),
  from_address: z.string(),
  username: z.string().nullable(),
  starttls: z.boolean(),
});
export type ExportedSmtp = z.infer<typeof exportedSmtpSchema>;

export const exportedSubjectSchema = z.strictObject({
  username: z.string(),
  email: z.string().nullable(),
  enabled: z.boolean(),
  profile: z.strictObject(profileSchema.omit({ profile_updated_at: true }).shape),
  roles: z.array(roleReferenceSchema).max(ASSIGNMENT_LIMIT),
  groups: z.array(z.string()).max(ASSIGNMENT_LIMIT),
  required_actions: z.array(requiredActionSchema),
});
export type ExportedSubject = z.infer<typeof exportedSubjectSchema>;

export const tenantDocumentSchema = z.strictObject({
  version: z.literal(1),
  settings: tenantSettingsDocumentSchema,
  flow: z.array(exportedFlowStepSchema),
  clients: z.array(exportedClientSchema),
  roles: z.array(exportedRoleSchema),
  groups: z.array(exportedGroupSchema),
  scopes: z.array(exportedScopeSchema),
  registration_policy: registrationPolicySchema,
  smtp: exportedSmtpSchema.nullable(),
  subjects: z.array(exportedSubjectSchema).optional(),
  // The JSON path of each secret a consumer would expect and the document
  // deliberately leaves out, such as `clients[2].secret`, or of a key it
  // stripped private members from, such as `clients[0].jwks.keys[1]`.
  omitted: z.array(z.string()),
});
export type TenantDocument = z.infer<typeof tenantDocumentSchema>;

// A document with the export's maximum of subjects runs to several
// megabytes, past Fastify's default one-mebibyte body limit.
export const TENANT_IMPORT_BODY_LIMIT = 16 * 1024 * 1024;

// `document` is left unchecked here and validated by the import itself, so
// every problem in it is answered at once, each with its path, rather than
// the first one a schema validator stops at.
export const importTenantRequestSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().min(1).optional(),
  document: z
    .unknown()
    .describe('A tenant document, as GET /admin/tenants/{tenant}/export answers it.'),
});
export type ImportTenantRequest = z.infer<typeof importTenantRequestSchema>;

export const importedClientSecretSchema = z.strictObject({
  client_id: z.string(),
  secret: z.string(),
});

export const importTenantResponseSchema = z.object({
  tenant: tenantSchema,
  client_secrets: z.array(importedClientSecretSchema),
});
export type ImportTenantResponse = z.infer<typeof importTenantResponseSchema>;

// One problem with an import request, by its JSON path from the request body.
export const importErrorSchema = fieldErrorSchema;
export type ImportError = FieldError;
