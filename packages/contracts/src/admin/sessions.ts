import { z } from 'zod';
import { createdAtSchema, idSchema } from '#/admin/shared';

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
