import { z } from 'zod';
import {
  createdAtSchema,
  cursorQuerySchema,
  enabledFilterSchema,
  idSchema,
  searchPrefixSchema,
} from '#/admin/shared';
import { ADMIN_CAPABILITIES } from '#/admin/whoami';

// A capability, or `tenant-admin`, which nests every one: held effectively —
// directly, through a group or its ancestors, or nested under another role.
export const SUBJECT_CAPABILITY_FILTER = [...ADMIN_CAPABILITIES, 'tenant-admin'] as const;

const subjectFilters = {
  username: searchPrefixSchema.optional(),
  email: searchPrefixSchema.optional(),
  enabled: enabledFilterSchema.optional(),
  role: z.uuid().optional(),
  group: z.uuid().optional(),
  capability: z.enum(SUBJECT_CAPABILITY_FILTER).optional(),
};
// Addressed to the second field, the one a caller adds to an existing search.
const oneSubjectSearchRule = {
  message: 'search one field at a time: username or email, not both',
  path: ['email'],
};
const oneSubjectSearch = [
  (query: { username?: string | undefined; email?: string | undefined }) =>
    query.username === undefined || query.email === undefined,
  oneSubjectSearchRule,
] as const;

export const listSubjectsQuerySchema = cursorQuerySchema
  .extend(subjectFilters)
  .strict()
  .refine(...oneSubjectSearch);
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;

export const countSubjectsQuerySchema = z
  .object(subjectFilters)
  .strict()
  .refine(...oneSubjectSearch);
export type CountSubjectsQuery = z.infer<typeof countSubjectsQuerySchema>;

export const subjectTypeSchema = z.enum(['user', 'service', 'agent_instance']);

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

export const listSubjectsResponseSchema = z.object({
  items: z.array(subjectSchema),
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

export const setRequiredActionsRequestSchema = z.object({
  actions: z.array(requiredActionSchema),
});
export type SetRequiredActionsRequest = z.infer<typeof setRequiredActionsRequestSchema>;

export const setRequiredActionsResponseSchema = z.object({
  actions: z.array(requiredActionSchema),
});
export type SetRequiredActionsResponse = z.infer<typeof setRequiredActionsResponseSchema>;

export const setRolesRequestSchema = z.object({
  role_ids: z.array(idSchema),
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
