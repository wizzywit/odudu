import { z } from 'zod';
import {
  ASSIGNMENT_LIMIT,
  createdAtSchema,
  cursorQuerySchema,
  enabledFilterSchema,
  idSchema,
  searchPrefixSchema,
} from '#/admin/shared';
import { ADMIN_CAPABILITIES } from '#/admin/whoami';

// A capability, or `tenant-admin`, which nests every one: held effectively —
// directly, through a group or its ancestors, or nested under another role.
// `any` is a holder of at least one.
export const SUBJECT_CAPABILITY_FILTER = [...ADMIN_CAPABILITIES, 'tenant-admin', 'any'] as const;

export const subjectTypeSchema = z.enum(['user', 'service', 'agent_instance']);

// Each a prefix of one column, matched case-insensitively; `name`,
// `given_name` and `family_name` are the OIDC claim columns as stored, never
// the username a `name` claim falls back to.
export const SUBJECT_SEARCH_FIELDS = [
  'username',
  'email',
  'name',
  'given_name',
  'family_name',
] as const;
export type SubjectSearchField = (typeof SUBJECT_SEARCH_FIELDS)[number];

const subjectFilters = {
  username: searchPrefixSchema.optional(),
  email: searchPrefixSchema.optional(),
  name: searchPrefixSchema.optional(),
  given_name: searchPrefixSchema.optional(),
  family_name: searchPrefixSchema.optional(),
  enabled: enabledFilterSchema.optional(),
  role: z.uuid().optional(),
  group: z.uuid().optional(),
  capability: z.enum(SUBJECT_CAPABILITY_FILTER).optional(),
  type: subjectTypeSchema.optional(),
  // Locked now, by the server's clock: what `GET …/subjects/{id}/lockout` answers as `locked`.
  locked: enabledFilterSchema.optional(),
};

type SearchedQuery = Partial<Record<SubjectSearchField, string | undefined>>;

function searchedFields(query: SearchedQuery): SubjectSearchField[] {
  return SUBJECT_SEARCH_FIELDS.filter((field) => query[field] !== undefined);
}

// Addressed to the second field, the one a caller adds to an existing search.
function oneSubjectSearch(query: SearchedQuery, ctx: z.RefinementCtx): void {
  const [first, second] = searchedFields(query);
  if (first === undefined || second === undefined) return;
  ctx.addIssue({
    code: 'custom',
    message: `search one field at a time: ${first} or ${second}, not both`,
    path: [second],
  });
}

export const listSubjectsQuerySchema = cursorQuerySchema
  .extend(subjectFilters)
  .strict()
  .superRefine(oneSubjectSearch);
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;

export const countSubjectsQuerySchema = z
  .object(subjectFilters)
  .strict()
  .superRefine(oneSubjectSearch);
export type CountSubjectsQuery = z.infer<typeof countSubjectsQuerySchema>;

// username and email are null for a subject with no `users` row — a
// service or agent_instance subject, which authenticates as itself rather
// than as somebody with a profile.
export const subjectSchema = z.object({
  id: idSchema,
  type: subjectTypeSchema,
  username: z.string().nullable(),
  email: z.string().nullable(),
  enabled: z.boolean(),
  created_at: createdAtSchema,
});
export type Subject = z.infer<typeof subjectSchema>;

// What a listed subject holds of the admin vocabulary, carried only by a
// listing filtered by `capability`: each name held effectively, and whether
// it is assigned directly rather than only through a group or a composite.
export const heldAdminCapabilitySchema = z.object({
  name: z.enum([...ADMIN_CAPABILITIES, 'tenant-admin']),
  direct: z.boolean(),
});
export type HeldAdminCapability = z.infer<typeof heldAdminCapabilitySchema>;

export const listedSubjectSchema = subjectSchema.extend({
  admin_capabilities: z.array(heldAdminCapabilitySchema).optional(),
});
export type ListedSubject = z.infer<typeof listedSubjectSchema>;

export const listSubjectsResponseSchema = z.object({
  items: z.array(listedSubjectSchema),
  next: z.string().optional(),
});
export type ListSubjectsResponse = z.infer<typeof listSubjectsResponseSchema>;

// Whether a rename is accepted in this tenant: the `username_editable`
// setting, readable by whoever can read subjects, so a form can show the
// username fixed rather than offer it and be refused.
export const usernamePolicySchema = z.object({
  username_editable: z.boolean(),
});
export type UsernamePolicy = z.infer<typeof usernamePolicySchema>;

// The one rule a username is held to, on creation and on a rename alike.
// Uniqueness is the `users_username_unique` constraint, which compares
// exactly; the console shows the rule in these words before it asks.
export const usernameSchema = z.string().min(1);
export const USERNAME_RULE =
  'a username must be at least one character, and no other subject in the tenant may hold it: ' +
  'case counts, so Ada and ada are different usernames';

// No `password` field, deliberately: creating a subject through this door
// writes an `update-password` required action instead, so no operator ever
// handles a user's password. Zod's default `z.object` already emits
// `additionalProperties: false`, so a body carrying one is refused before
// the usecase ever sees it.
export const createSubjectRequestSchema = z.object({
  username: usernameSchema,
  email: z.string().min(1).optional(),
});
export type CreateSubjectRequest = z.infer<typeof createSubjectRequestSchema>;

// `username` is accepted only where the tenant's `username_editable` is on,
// and then only under `If-Match` (docs/admin-paths.md).
export const amendSubjectRequestSchema = z.object({
  username: usernameSchema.optional(),
  email: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type AmendSubjectRequest = z.infer<typeof amendSubjectRequestSchema>;

// `password-history` never appears here: a retired hash answers no
// question this endpoint is for, and is never a credential a caller could
// name to `DELETE .../credentials/{id}`.
export const credentialTypeSchema = z.enum(['password', 'totp', 'webauthn', 'recovery-code']);

// Metadata only — never a hash, never `secret_data`. `recovery-code` rows
// are collapsed into one entry carrying `recovery_code_count` rather than
// listed individually — ADR 0021 keeps a spent code's row, so a per-row
// listing would answer "how many were ever issued", not "how many still
// work", which is the question this endpoint exists to answer. That entry
// carries no `id`: it names no single row a caller could delete.
export const credentialSchema = z.object({
  id: idSchema.optional(),
  type: credentialTypeSchema,
  created_at: createdAtSchema,
  expired: z.boolean().optional(),
  recovery_code_count: z.number().int().optional(),
});
export type Credential = z.infer<typeof credentialSchema>;

export const listCredentialsResponseSchema = z.object({
  items: z.array(credentialSchema),
});
export type ListCredentialsResponse = z.infer<typeof listCredentialsResponseSchema>;

export const requiredActionSchema = z.enum([
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
]);
export type RequiredAction = z.infer<typeof requiredActionSchema>;

export const setRequiredActionsRequestSchema = z.object({
  actions: z.array(requiredActionSchema),
});
export type SetRequiredActionsRequest = z.infer<typeof setRequiredActionsRequestSchema>;

export const setRequiredActionsResponseSchema = z.object({
  actions: z.array(requiredActionSchema),
});
export type SetRequiredActionsResponse = z.infer<typeof setRequiredActionsResponseSchema>;

// A mailed link takes the subject through `actions`.
export const sendActionsEmailRequestSchema = z
  .object({ actions: z.array(requiredActionSchema).min(1) })
  .strict();
export type SendActionsEmailRequest = z.infer<typeof sendActionsEmailRequestSchema>;

export const setRolesRequestSchema = z.object({
  role_ids: z.array(idSchema).max(ASSIGNMENT_LIMIT),
});
export type SetRolesRequest = z.infer<typeof setRolesRequestSchema>;

// The owning client by row id and by `client_id`, both null for a tenant
// role: a tenant role and a client's can share a name.
export const roleAssignmentSchema = z.object({
  id: idSchema,
  name: z.string(),
  client_id: idSchema.nullable(),
  client_key: z.string().nullable(),
});

export const setRolesResponseSchema = z.object({
  items: z.array(roleAssignmentSchema),
});
export type SetRolesResponse = z.infer<typeof setRolesResponseSchema>;

// How a subject came to hold a role: assigned it, through a group it belongs
// to or one of that group's ancestors, or nested under another role it holds.
export const roleProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct') }),
  z.object({ kind: z.literal('group'), group_id: idSchema, group_path: z.string() }),
  z.object({ kind: z.literal('composite'), parent_role_id: idSchema, parent_name: z.string() }),
]);
export type RoleProvenance = z.infer<typeof roleProvenanceSchema>;

export const effectiveRoleSchema = roleAssignmentSchema.extend({
  via: z.array(roleProvenanceSchema),
});
export type EffectiveRoleAssignment = z.infer<typeof effectiveRoleSchema>;

export const listEffectiveRolesQuerySchema = cursorQuerySchema.strict();
export type ListEffectiveRolesQuery = z.infer<typeof listEffectiveRolesQuerySchema>;

export const listEffectiveRolesResponseSchema = z.object({
  items: z.array(effectiveRoleSchema),
  next: z.string().optional(),
});
export type ListEffectiveRolesResponse = z.infer<typeof listEffectiveRolesResponseSchema>;

// The admin capabilities a subject holds, each with how, and the roles that
// carry them (a role nesting one, held directly or through a group): what a
// reader needs to say what losing a role would take, which a page of the
// subject's roles cannot answer. Sized by the model, at most
// ADMIN_CARRIER_LIMIT; `complete` is false when more carry them, and a
// reader must then judge nothing from it.
export const ADMIN_CARRIER_LIMIT = 200;
export const adminCapabilitiesResponseSchema = z.object({
  items: z.array(effectiveRoleSchema),
  complete: z.boolean(),
});
export type AdminCapabilitiesResponse = z.infer<typeof adminCapabilitiesResponseSchema>;

export const BULK_SUBJECT_ACTIONS = ['disable', 'enable', 'delete', 'end-sessions'] as const;
export const BULK_SUBJECT_LIMIT = 100;

export const bulkSubjectsRequestSchema = z.object({
  action: z.enum(BULK_SUBJECT_ACTIONS),
  ids: z.array(z.uuid()).min(1).max(BULK_SUBJECT_LIMIT),
});
export type BulkSubjectsRequest = z.infer<typeof bulkSubjectsRequestSchema>;

// Each id answered as its own request to the single-subject door would be:
// the status it would carry, and a refusal's problem `type` and `detail`.
export const bulkSubjectResultSchema = z.object({
  id: idSchema,
  status: z.number().int(),
  type: z.string().optional(),
  detail: z.string().optional(),
  ended: z.number().int().nonnegative().optional(),
});
export type BulkSubjectResult = z.infer<typeof bulkSubjectResultSchema>;

export const bulkSubjectsResponseSchema = z.object({
  items: z.array(bulkSubjectResultSchema),
});
export type BulkSubjectsResponse = z.infer<typeof bulkSubjectsResponseSchema>;

// Cleared from the subjects the caller's ceiling reaches, a batch at a time;
// `remaining` counts those still locked, for the next call, and
// `beyond_ceiling` the subjects left as they were. Neither counts past
// 10,000.
export const clearLockoutsResponseSchema = z.object({
  cleared: z.number().int().nonnegative(),
  beyond_ceiling: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type ClearLockoutsResponse = z.infer<typeof clearLockoutsResponseSchema>;
