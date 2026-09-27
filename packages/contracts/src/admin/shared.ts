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

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  instance: z.string(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const idSchema = z.string();
export const createdAtSchema = z.string();
export const etagSchema = z.string();
