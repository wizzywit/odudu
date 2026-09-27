import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, dateTimeSchema, idSchema } from '#/admin/shared';

// The admin console's own view of a token: never `token_hash`, and never
// the plaintext — that appears only in `mintRegistrationTokenResponseSchema`,
// the one response body a mint answers.
export const registrationTokenSchema = z.object({
  id: idSchema,
  remaining_uses: z.number().int(),
  created_at: createdAtSchema,
  expires_at: dateTimeSchema,
});
export type RegistrationToken = z.infer<typeof registrationTokenSchema>;

export const listRegistrationTokensQuerySchema = cursorQuerySchema.extend({}).strict();
export type ListRegistrationTokensQuery = z.infer<typeof listRegistrationTokensQuerySchema>;

export const listRegistrationTokensResponseSchema = z.object({
  items: z.array(registrationTokenSchema),
  next: z.string().optional(),
});
export type ListRegistrationTokensResponse = z.infer<typeof listRegistrationTokensResponseSchema>;

// `remaining_uses` is a Postgres `integer` column
// (`packages/domain-tenant/src/schema/client-registration-tokens.ts`), so
// `uses` is bounded at its max rather than left to overflow into a 500 the
// INSERT itself would throw. A year is this project's own ceiling on how
// long an initial access token may outlive the operator who minted it —
// there is no protocol or storage limit forcing that number, only the
// judgement that a token still redeemable a year on has outlived its
// purpose as a short-lived bootstrap credential.
const INT32_MAX = 2_147_483_647;
const MAX_TTL_SECONDS = 31_536_000;

export const mintRegistrationTokenRequestSchema = z.object({
  uses: z.number().int().min(1).max(INT32_MAX),
  ttl_seconds: z.number().int().min(60).max(MAX_TTL_SECONDS),
});
export type MintRegistrationTokenRequest = z.infer<typeof mintRegistrationTokenRequestSchema>;

// The only response body that ever carries `token` — a `GET` answers
// `registrationTokenSchema`, which has no such field.
export const mintRegistrationTokenResponseSchema = z.object({
  id: idSchema,
  token: z.string(),
  remaining_uses: z.number().int(),
  expires_at: dateTimeSchema,
});
export type MintRegistrationTokenResponse = z.infer<typeof mintRegistrationTokenResponseSchema>;
