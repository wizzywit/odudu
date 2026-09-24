import { z } from 'zod';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

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
