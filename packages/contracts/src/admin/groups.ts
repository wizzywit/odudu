import { z } from 'zod';
import { roleAssignmentSchema } from '#/admin/subjects';
import { createdAtSchema, cursorQuerySchema, idSchema, searchPrefixSchema } from '#/admin/shared';

export const groupSchema = z.object({
  id: idSchema,
  name: z.string(),
  parent_id: idSchema.nullable(),
  path: z.string(),
  created_at: createdAtSchema,
});
export type Group = z.infer<typeof groupSchema>;

// One level of the tree: the children of the group `parent` names, or the
// groups with no parent at all under `root`.
const groupFilters = {
  name: searchPrefixSchema.optional(),
  parent: z.union([z.uuid(), z.literal('root')]).optional(),
};

export const listGroupsQuerySchema = cursorQuerySchema.extend(groupFilters).strict();
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

export const countGroupsQuerySchema = z.object(groupFilters).strict();
export type CountGroupsQuery = z.infer<typeof countGroupsQuerySchema>;

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
// the group and every descendant and refuses a cycle. `name` is never
// amended, by ADR 0039, and `path` follows from it and the parent.
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

// A subject's direct memberships. Lives beside `groupSchema` rather than in
// #/admin/subjects, which this module already imports from.
export const setSubjectGroupsRequestSchema = z.object({
  group_ids: z.array(idSchema),
});
export type SetSubjectGroupsRequest = z.infer<typeof setSubjectGroupsRequestSchema>;

export const setSubjectGroupsResponseSchema = z.object({
  items: z.array(groupSchema),
});
export type SetSubjectGroupsResponse = z.infer<typeof setSubjectGroupsResponseSchema>;
