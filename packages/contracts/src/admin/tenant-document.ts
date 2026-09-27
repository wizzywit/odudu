import { z } from 'zod';
import { clientTypeSchema, registrationOriginSchema } from '#/admin/clients';
import { executionRequirementSchema } from '#/admin/flow';
import { profileSchema } from '#/admin/profile';
import { clientScopeAssignmentSchema } from '#/admin/scopes';
import { requiredActionSchema } from '#/admin/subjects';

// Above this many subjects `?include=subjects` is refused rather than
// answered: moving users in bulk is inbound provisioning's job, not a
// single response body's.
export const EXPORT_SUBJECT_CAP = 10_000;

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

const settingValueSchema = z.union([z.boolean(), z.number(), z.string()]).nullable();

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
  type: clientTypeSchema,
  enabled: z.boolean(),
  full_scope_allowed: z.boolean(),
  registration_origin: registrationOriginSchema,
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  audiences: z.array(z.string()),
  access_token_ttl_seconds: z.number().int(),
  refresh_token_ttl_seconds: z.number().int(),
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
  // The roles a confidential client's own service account holds, which
  // its client_credentials tokens carry; empty for a public client.
  service_account_roles: z.array(roleReferenceSchema),
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
  composites: z.array(roleReferenceSchema),
});
export type ExportedRole = z.infer<typeof exportedRoleSchema>;

export const exportedGroupSchema = z.strictObject({
  path: z.string(),
  roles: z.array(roleReferenceSchema),
});
export type ExportedGroup = z.infer<typeof exportedGroupSchema>;

export const exportedScopeSchema = z.strictObject({
  name: z.string(),
  description: z.string().nullable(),
  include_in_id_token: z.boolean(),
  include_in_access_token: z.boolean(),
  builtin: z.boolean(),
  roles: z.array(roleReferenceSchema),
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
  roles: z.array(roleReferenceSchema),
  groups: z.array(z.string()),
  required_actions: z.array(requiredActionSchema),
});
export type ExportedSubject = z.infer<typeof exportedSubjectSchema>;

export const tenantDocumentSchema = z.strictObject({
  version: z.literal(1),
  settings: z.record(z.string(), settingValueSchema),
  flow: z.array(exportedFlowStepSchema),
  clients: z.array(exportedClientSchema),
  roles: z.array(exportedRoleSchema),
  groups: z.array(exportedGroupSchema),
  scopes: z.array(exportedScopeSchema),
  registration_policy: registrationPolicySchema,
  smtp: exportedSmtpSchema.nullable(),
  subjects: z.array(exportedSubjectSchema).optional(),
  // The JSON path of each secret a consumer would expect and the document
  // deliberately leaves out, such as `clients[2].secret`.
  omitted: z.array(z.string()),
});
export type TenantDocument = z.infer<typeof tenantDocumentSchema>;
