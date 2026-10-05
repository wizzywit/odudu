import { z } from 'zod';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// A shape check, not a policy check: an over-large `limit` is a page size
// to coerce down, never a request to refuse (design spec §9, citing
// AIP-158) — `MAX_LIMIT` is enforced exactly once, by
// @odudu/protocol-admin's `coerceLimit`, not here as well.
export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

// A search is a prefix of one named field, matched case-insensitively;
// the exact filters AND with it and with each other. A prefix is text
// PostgreSQL can hold, which excludes NUL.
export const searchPrefixSchema = z
  .string()
  .min(1)
  .regex(/^[^\u0000]*$/);

export const enabledFilterSchema = z.enum(['true', 'false']);

// One field a refusal names, by its JSON path from the request: `name`, or
// `document.clients[0].redirect_uris`.
export const fieldErrorSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

// `detail` is prose for a person; `errors` names each field at fault, so a
// client can place a message under its field without parsing `detail`.
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  instance: z.string(),
  detail: z.string().optional(),
  errors: z.array(fieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const idSchema = z.string();
// An ISO 8601 instant, wire-shaped as a bare string — never validated more
// strictly than that, since every producer here is this server's own
// `Date#toISOString()`. `createdAtSchema` is this under the name most call
// sites reach for; a field that isn't a `created_at` uses this one instead
// of borrowing a name that would say otherwise.
export const dateTimeSchema = z.string();
export const createdAtSchema = dateTimeSchema;
export const etagSchema = z.string();

/** The longest description a group, role or client holds, by its CHECK. */
export const DESCRIPTION_MAX = 1000;

export const descriptionSchema = z.string().min(1).max(DESCRIPTION_MAX);
