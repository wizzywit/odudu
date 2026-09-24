import { z } from 'zod';
import { roleAssignmentSchema } from '#/admin/subjects';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

export const groupSchema = z.object({
  id: idSchema,
  name: z.string(),
  parent_id: idSchema.nullable(),
  path: z.string(),
  created_at: createdAtSchema,
});
export type Group = z.infer<typeof groupSchema>;

export const listGroupsQuerySchema = cursorQuerySchema;
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

export const listGroupsResponseSchema = z.object({
  items: z.array(groupSchema),
  next: z.string().optional(),
});
export type ListGroupsResponse = z.infer<typeof listGroupsResponseSchema>;

export const createGroupRequestSchema = z.object({
  name: z.string().min(1),
  parent_id: idSchema.nullable().optional(),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

// `parent_id` is the only field a general amendment reaches: reparenting,
// through groupRepository.reparent, which is what recomputes `path` for
// the group and every descendant and refuses a cycle. `name` and `path`
// have no amendment door of their own yet — see group-patch.ts.
export const amendGroupRequestSchema = z.record(z.string(), z.unknown());
export type AmendGroupRequest = z.infer<typeof amendGroupRequestSchema>;

export const setGroupRolesRequestSchema = z.object({
  role_ids: z.array(idSchema),
});
export type SetGroupRolesRequest = z.infer<typeof setGroupRolesRequestSchema>;

export const setGroupRolesResponseSchema = z.object({
  items: z.array(roleAssignmentSchema),
});
export type SetGroupRolesResponse = z.infer<typeof setGroupRolesResponseSchema>;
