import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// `client_id` null means a tenant role; non-null means one scoped to that
// client, whose qualified name (packages/domain-authz's qualifiedRoleName)
// is what a token actually carries.
export const roleSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  client_id: idSchema.nullable(),
  default_for_new_subjects: z.boolean(),
  created_at: createdAtSchema,
});
export type Role = z.infer<typeof roleSchema>;

export const listRolesQuerySchema = cursorQuerySchema;
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;

export const listRolesResponseSchema = z.object({
  items: z.array(roleSchema),
  next: z.string().optional(),
});
export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>;

export const createRoleRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  client_id: idSchema.optional(),
  default_for_new_subjects: z.boolean().optional(),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

// A caller may name any field it believes is a role field, amendable or
// not — the usecase, not this shape, is what tells the two apart and gives
// the excluded one its reason (role-patch.ts's `refusalFor`).
export const amendRoleRequestSchema = z.record(z.string(), z.unknown());
export type AmendRoleRequest = z.infer<typeof amendRoleRequestSchema>;

export const addRoleCompositeRequestSchema = z.object({
  child_role_id: idSchema,
});
export type AddRoleCompositeRequest = z.infer<typeof addRoleCompositeRequestSchema>;
