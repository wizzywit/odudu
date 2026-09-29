import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema, searchPrefixSchema } from '#/admin/shared';

// `client_id` null means a tenant role; non-null means one scoped to that
// client, whose qualified name (packages/domain-authz's qualifiedRoleName)
// is what a token actually carries. `client_key` is that client's own
// `client_id`, the name a person tells it apart by.
export const roleSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  client_id: idSchema.nullable(),
  client_key: z.string().nullable(),
  default_for_new_subjects: z.boolean(),
  created_at: createdAtSchema,
});
export type Role = z.infer<typeof roleSchema>;

// `client` narrows to one owner: `tenant` for the tenant roles, or a
// client's id for the roles scoped to it.
const roleFilters = {
  name: searchPrefixSchema.optional(),
  client: z.union([z.literal('tenant'), z.uuid()]).optional(),
};

export const listRolesQuerySchema = cursorQuerySchema.extend(roleFilters).strict();
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;

export const countRolesQuerySchema = z.object(roleFilters).strict();
export type CountRolesQuery = z.infer<typeof countRolesQuerySchema>;

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

export const listRoleCompositesResponseSchema = z.object({
  items: z.array(roleSchema),
});
export type ListRoleCompositesResponse = z.infer<typeof listRoleCompositesResponseSchema>;

export const setRoleDefaultRequestSchema = z.object({
  default: z.boolean(),
});
export type SetRoleDefaultRequest = z.infer<typeof setRoleDefaultRequestSchema>;
