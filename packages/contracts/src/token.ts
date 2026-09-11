import { z } from 'zod';

// The /token body schemas, one per grant type P1 implements (design spec
// §6, stage 3 is grant-specific; stages 1-2 are shared and live in Task 13).
export const authorizationCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string(),
  redirect_uri: z.string(),
  client_id: z.string().optional(),
  code_verifier: z.string(),
});

export const refreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string(),
  scope: z.string().optional(),
});

export const clientCredentialsGrantSchema = z.object({
  grant_type: z.literal('client_credentials'),
  scope: z.string().optional(),
});

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  authorizationCodeGrantSchema,
  refreshTokenGrantSchema,
  clientCredentialsGrantSchema,
]);

export type TokenRequest = z.infer<typeof tokenRequestSchema>;
