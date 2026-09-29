import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, dateTimeSchema, idSchema } from '#/admin/shared';

// `client_ids` is the OAuth `client_id` strings the session holds a grant
// for — what an operator ending it needs to recognise, not the clients
// table's own surrogate ids.
export const sessionSchema = z.object({
  id: idSchema,
  created_at: createdAtSchema,
  last_active_at: createdAtSchema,
  remembered: z.boolean(),
  client_ids: z.array(z.string()),
});
export type Session = z.infer<typeof sessionSchema>;

export const listSessionsResponseSchema = z.object({
  items: z.array(sessionSchema),
  next: z.string().optional(),
});
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;

export const endSessionsResponseSchema = z.object({
  ended: z.number().int().nonnegative(),
});
export type EndSessionsResponse = z.infer<typeof endSessionsResponseSchema>;

// A session listed across the whole tenant, so it names whose it is.
export const tenantSessionSchema = sessionSchema.extend({
  subject_id: idSchema,
  username: z.string().nullable(),
});
export type TenantSession = z.infer<typeof tenantSessionSchema>;

// `client` is a client's row id: the sessions that hold a grant through it.
const sessionFilters = { client: z.uuid().optional() };

export const listTenantSessionsQuerySchema = cursorQuerySchema.extend(sessionFilters).strict();
export type ListTenantSessionsQuery = z.infer<typeof listTenantSessionsQuerySchema>;

export const countSessionsQuerySchema = z.object(sessionFilters).strict();
export type CountSessionsQuery = z.infer<typeof countSessionsQuerySchema>;

export const listTenantSessionsResponseSchema = z.object({
  items: z.array(tenantSessionSchema),
  next: z.string().optional(),
});
export type ListTenantSessionsResponse = z.infer<typeof listTenantSessionsResponseSchema>;

// `remaining` counts what is still live within reach, for the next call;
// `beyond_ceiling` what was left alone because its subject holds an admin
// capability the caller does not (ADR 0040).
export const endTenantSessionsResponseSchema = z.object({
  ended: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  beyond_ceiling: z.number().int().nonnegative(),
});
export type EndTenantSessionsResponse = z.infer<typeof endTenantSessionsResponseSchema>;

// A token grant a subject still holds: `offline` when its scope carries
// `offline_access`, which ending sessions leaves alone. A grant can be bound
// to no session without being offline: a `client_credentials` token's is.
// `refresh_expires_at` is when its newest unspent refresh token lapses, null
// when it has none.
export const grantSchema = z.object({
  id: idSchema,
  client_id: idSchema,
  client_key: z.string(),
  scope: z.string(),
  created_at: createdAtSchema,
  session_id: idSchema.nullable(),
  offline: z.boolean(),
  refresh_expires_at: dateTimeSchema.nullable(),
});
export type Grant = z.infer<typeof grantSchema>;

export const listGrantsResponseSchema = z.object({
  items: z.array(grantSchema),
  next: z.string().optional(),
});
export type ListGrantsResponse = z.infer<typeof listGrantsResponseSchema>;

export const revokeGrantsResponseSchema = z.object({
  revoked: z.number().int().nonnegative(),
});
export type RevokeGrantsResponse = z.infer<typeof revokeGrantsResponseSchema>;

export const revokeClientGrantsResponseSchema = revokeGrantsResponseSchema.extend({
  beyond_ceiling: z.number().int().nonnegative(),
});
export type RevokeClientGrantsResponse = z.infer<typeof revokeClientGrantsResponseSchema>;
