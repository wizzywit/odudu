import { z } from 'zod';

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
