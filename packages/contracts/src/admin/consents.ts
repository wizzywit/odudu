import { z } from 'zod';
import { createdAtSchema, idSchema } from '#/admin/shared';

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

// Bounded per subject, the same as `listCredentialsResponseSchema` — no
// cursor.
export const listConsentsResponseSchema = z.object({
  items: z.array(consentSchema),
});
export type ListConsentsResponse = z.infer<typeof listConsentsResponseSchema>;
