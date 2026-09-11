import { z } from 'zod';

// The /token body schemas, one per supported grant type. Only the
// grant-specific validation stage differs between them; client authentication
// and structural validation are shared by the token endpoint itself.
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
