import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

export const listSubjectsQuerySchema = cursorQuerySchema.extend({
  search: z.string().min(1).optional(),
});
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;

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

// No `password` field, deliberately: creating a subject through this door
// writes an `update-password` required action instead, so no operator ever
// handles a user's password. Zod's default `z.object` already emits
// `additionalProperties: false`, so a body carrying one is refused before
// the usecase ever sees it.
export const createSubjectRequestSchema = z.object({
  username: z.string().min(1),
  email: z.string().min(1).optional(),
});
export type CreateSubjectRequest = z.infer<typeof createSubjectRequestSchema>;

export const amendSubjectRequestSchema = z.object({
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

export const roleAssignmentSchema = z.object({
  id: idSchema,
  name: z.string(),
});

export const setRolesResponseSchema = z.object({
  items: z.array(roleAssignmentSchema),
});
export type SetRolesResponse = z.infer<typeof setRolesResponseSchema>;
