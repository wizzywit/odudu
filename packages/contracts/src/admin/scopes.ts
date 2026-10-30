import { z } from 'zod';
import { noBidiControls } from '#/bidi';
import { countResponseSchema } from '#/admin/counts';
import { adminReachSchema } from '#/admin/roles';
import { roleAssignmentSchema } from '#/admin/subjects';
import {
  ASSIGNMENT_LIMIT,
  createdAtSchema,
  cursorQuerySchema,
  DESCRIPTION_MAX,
  idSchema,
  localisedTextSchema,
  searchPrefixSchema,
} from '#/admin/shared';

export const clientScopeAssignmentSchema = z.enum(['default', 'optional']);

/** The longest consent text a scope holds, by its CHECK. */
export const CONSENT_TEXT_MAX = 500;
export const consentTextSchema = noBidiControls(z.string().min(1).max(CONSENT_TEXT_MAX));
export const displayOrderSchema = z.number().int().min(0).max(2_147_483_647);

// `default_client_assignment` is how a client created afterwards is assigned
// the scope — by an administrator, dynamic registration or `odudu seed` —
// and null when it is not. The consent screen lists scopes by
// `display_order`, then name, each by its `consent_text` where it has one.
export const clientScopeSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  include_in_id_token: z.boolean(),
  include_in_access_token: z.boolean(),
  default_client_assignment: clientScopeAssignmentSchema.nullable(),
  consent_text: z.string().nullable(),
  description_i18n: localisedTextSchema,
  consent_text_i18n: localisedTextSchema,
  display_order: z.number().int(),
  created_at: createdAtSchema,
});
export type ClientScope = z.infer<typeof clientScopeSchema>;

const scopeFilters = { name: searchPrefixSchema.optional() };

export const listScopesQuerySchema = cursorQuerySchema.extend(scopeFilters).strict();
export type ListScopesQuery = z.infer<typeof listScopesQuerySchema>;

export const countScopesQuerySchema = z.object(scopeFilters).strict();
export type CountScopesQuery = z.infer<typeof countScopesQuerySchema>;

export const listScopesResponseSchema = z.object({
  items: z.array(clientScopeSchema),
  next: z.string().optional(),
});
export type ListScopesResponse = z.infer<typeof listScopesResponseSchema>;

export const createScopeRequestSchema = z.object({
  name: z.string().min(1),
  description: noBidiControls(z.string().min(1).max(DESCRIPTION_MAX)).nullable().optional(),
  include_in_id_token: z.boolean().optional(),
  include_in_access_token: z.boolean().optional(),
  default_client_assignment: clientScopeAssignmentSchema.nullable().optional(),
  consent_text: consentTextSchema.nullable().optional(),
  description_i18n: localisedTextSchema.optional(),
  consent_text_i18n: localisedTextSchema.optional(),
  display_order: displayOrderSchema.optional(),
});
export type CreateScopeRequest = z.infer<typeof createScopeRequestSchema>;

// A caller may name any field it believes is a scope field, amendable or
// not — the usecase, not this shape, is what tells the two apart and gives
// the excluded one its reason (scope-patch.ts's `refusalFor`).
export const amendScopeRequestSchema = z.record(z.string(), z.unknown());
export type AmendScopeRequest = z.infer<typeof amendScopeRequestSchema>;

export const setScopeRolesRequestSchema = z.object({
  role_ids: z.array(idSchema).max(ASSIGNMENT_LIMIT),
});
export type SetScopeRolesRequest = z.infer<typeof setScopeRolesRequestSchema>;

// What each mapped role reaches of the admin vocabulary, as a group's roles
// carry it: derived on every read, never stored, outside the `ETag`.
export const scopeRoleSchema = roleAssignmentSchema.extend({ admin_reach: adminReachSchema });

export const setScopeRolesResponseSchema = z.object({
  items: z.array(scopeRoleSchema),
});
export type SetScopeRolesResponse = z.infer<typeof setScopeRolesResponseSchema>;

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

// Which clients carry a scope, readable with `manage-tenant` alone: a client
// named by its row id, `client_id` and name, and nothing of its configuration.
export const listScopeClientsQuerySchema = cursorQuerySchema.strict();
export type ListScopeClientsQuery = z.infer<typeof listScopeClientsQuerySchema>;

export const scopeClientSchema = z.object({
  id: idSchema,
  client_id: z.string(),
  name: z.string(),
  assignment: clientScopeAssignmentSchema,
});
export type ScopeClient = z.infer<typeof scopeClientSchema>;

export const listScopeClientsResponseSchema = z.object({
  items: z.array(scopeClientSchema),
  next: z.string().optional(),
});
export type ListScopeClientsResponse = z.infer<typeof listScopeClientsResponseSchema>;

// A built-in scope is deleted only by a caller who names it again: the scope's
// own name, as a tenant is deleted by `confirm`. An ordinary scope ignores it.
export const deleteScopeQuerySchema = z.object({ confirm: z.string().min(1).optional() }).strict();
export type DeleteScopeQuery = z.infer<typeof deleteScopeQuerySchema>;

// What deleting the scope would take with it: each count stops at the same
// ceiling the list counts do, so the read costs no more than a bounded one.
export const scopeImpactSchema = z.object({
  builtin: z.boolean(),
  client_assignments: countResponseSchema,
  role_mappings: countResponseSchema,
});
export type ScopeImpact = z.infer<typeof scopeImpactSchema>;

export const builtinScopeSchema = z.object({ name: z.string(), present: z.boolean() });
export type BuiltinScope = z.infer<typeof builtinScopeSchema>;

export const listBuiltinScopesResponseSchema = z.object({ items: z.array(builtinScopeSchema) });
export type ListBuiltinScopesResponse = z.infer<typeof listBuiltinScopesResponseSchema>;

export const restoreBuiltinScopesResponseSchema = z.object({ created: z.array(z.string()) });
export type RestoreBuiltinScopesResponse = z.infer<typeof restoreBuiltinScopesResponseSchema>;
