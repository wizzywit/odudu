import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

// `signing_keys_alg_check` (packages/db/drizzle/0003_signing_keys.sql): the
// only two algorithms a key can carry.
export const signingKeyAlgSchema = z.enum(['RS256', 'ES256']);
export type SigningKeyAlg = z.infer<typeof signingKeyAlgSchema>;

export const signingKeyStatusSchema = z.enum(['active', 'rotating', 'retired']);
export type SigningKeyStatus = z.infer<typeof signingKeyStatusSchema>;

// Never `public_jwk`, `private_jwk_encrypted` or any other private-key
// material — a signing key's admin representation is metadata about it,
// not the key itself.
export const signingKeySchema = z.object({
  id: idSchema,
  status: signingKeyStatusSchema,
  kid: z.string(),
  alg: signingKeyAlgSchema,
  created_at: createdAtSchema,
  not_after: z.string().nullable(),
});
export type SigningKey = z.infer<typeof signingKeySchema>;

export const listKeysQuerySchema = cursorQuerySchema;
export type ListKeysQuery = z.infer<typeof listKeysQuerySchema>;

export const listKeysResponseSchema = z.object({
  items: z.array(signingKeySchema),
  next: z.string().optional(),
});
export type ListKeysResponse = z.infer<typeof listKeysResponseSchema>;

export const createKeyRequestSchema = z.object({
  alg: signingKeyAlgSchema,
});
export type CreateKeyRequest = z.infer<typeof createKeyRequestSchema>;
