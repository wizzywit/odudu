import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// The admin console's own view of a token: never `token_hash`, and never
// the plaintext — that appears only in `mintRegistrationTokenResponseSchema`,
// the one response body a mint answers.
export const registrationTokenSchema = z.object({
  id: idSchema,
  remaining_uses: z.number().int(),
  created_at: createdAtSchema,
  expires_at: createdAtSchema,
});
export type RegistrationToken = z.infer<typeof registrationTokenSchema>;

export const listRegistrationTokensQuerySchema = cursorQuerySchema.extend({}).strict();
export type ListRegistrationTokensQuery = z.infer<typeof listRegistrationTokensQuerySchema>;

export const listRegistrationTokensResponseSchema = z.object({
  items: z.array(registrationTokenSchema),
  next: z.string().optional(),
});
export type ListRegistrationTokensResponse = z.infer<typeof listRegistrationTokensResponseSchema>;

export const mintRegistrationTokenRequestSchema = z.object({
  uses: z.number().int().min(1),
  ttl_seconds: z.number().int().min(60),
});
export type MintRegistrationTokenRequest = z.infer<typeof mintRegistrationTokenRequestSchema>;

// The only response body that ever carries `token` — a `GET` answers
// `registrationTokenSchema`, which has no such field.
export const mintRegistrationTokenResponseSchema = z.object({
  id: idSchema,
  token: z.string(),
  remaining_uses: z.number().int(),
  expires_at: createdAtSchema,
});
export type MintRegistrationTokenResponse = z.infer<typeof mintRegistrationTokenResponseSchema>;
