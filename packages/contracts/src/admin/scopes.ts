import { z } from 'zod';
import { roleAssignmentSchema } from '#/admin/subjects';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

export const clientScopeSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  include_in_id_token: z.boolean(),
  include_in_access_token: z.boolean(),
  created_at: createdAtSchema,
});
export type ClientScope = z.infer<typeof clientScopeSchema>;

export const listScopesQuerySchema = cursorQuerySchema;
export type ListScopesQuery = z.infer<typeof listScopesQuerySchema>;

export const listScopesResponseSchema = z.object({
  items: z.array(clientScopeSchema),
  next: z.string().optional(),
});
export type ListScopesResponse = z.infer<typeof listScopesResponseSchema>;

export const createScopeRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  include_in_id_token: z.boolean().optional(),
  include_in_access_token: z.boolean().optional(),
});
export type CreateScopeRequest = z.infer<typeof createScopeRequestSchema>;

// A caller may name any field it believes is a scope field, amendable or
// not — the usecase, not this shape, is what tells the two apart and gives
// the excluded one its reason (scope-patch.ts's `refusalFor`).
export const amendScopeRequestSchema = z.record(z.string(), z.unknown());
export type AmendScopeRequest = z.infer<typeof amendScopeRequestSchema>;

export const setScopeRolesRequestSchema = z.object({
  role_ids: z.array(idSchema),
});
export type SetScopeRolesRequest = z.infer<typeof setScopeRolesRequestSchema>;

export const setScopeRolesResponseSchema = z.object({
  items: z.array(roleAssignmentSchema),
});
export type SetScopeRolesResponse = z.infer<typeof setScopeRolesResponseSchema>;

export const clientScopeAssignmentSchema = z.enum(['default', 'optional']);

/** One scope as a client carries it — shared by the client shape and the assignment answer. */
export const clientScopeAssignmentViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  assignment: clientScopeAssignmentSchema,
});

export const assignScopeToClientRequestSchema = z.object({
  assignment: clientScopeAssignmentSchema,
});
export type AssignScopeToClientRequest = z.infer<typeof assignScopeToClientRequestSchema>;

// The client's scope assignments alone, not the client. `manage-tenant` is
// the right capability for arranging scopes, and it is deliberately weaker
// than the `manage-clients` that `GET /clients/:id` requires — answering
// with the whole client here would hand the weaker holder `redirect_uris`,
// `jwks`, `audiences` and every grant setting through a side door.
export const assignScopeToClientResponseSchema = z.object({
  client_id: idSchema,
  scopes: z.array(clientScopeAssignmentViewSchema),
});
export type AssignScopeToClientResponse = z.infer<typeof assignScopeToClientResponseSchema>;
