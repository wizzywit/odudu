import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// `client_id` is the client's own row id — what
// `DELETE .../consents/{clientId}` names — and `client_key` is the OAuth
// `client_id` string an operator recognises, the same split `sessionSchema`
// draws for its own `client_ids`.
export const consentSchema = z.object({
  client_id: idSchema,
  client_key: z.string(),
  scope_names: z.array(z.string()),
  granted_at: createdAtSchema,
});
export type Consent = z.infer<typeof consentSchema>;

export const listConsentsQuerySchema = cursorQuerySchema.extend({}).strict();
export type ListConsentsQuery = z.infer<typeof listConsentsQuerySchema>;

// A subject holds one consent per client it has used, and a tenant's clients
// are not bounded by the subject, so the list is paged.
export const listConsentsResponseSchema = z.object({
  items: z.array(consentSchema),
  next: z.string().optional(),
});
export type ListConsentsResponse = z.infer<typeof listConsentsResponseSchema>;
