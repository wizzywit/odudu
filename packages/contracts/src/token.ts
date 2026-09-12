import { z } from 'zod';

// The one list of client authentication methods Odudu's token endpoint
// honours, shared with client-oidc-config's stored value and discovery's
// advertisement so all three cannot drift apart: whatever a client can be
// configured to use is exactly what the endpoint accepts and discovery
// names.
export const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = [
  'client_secret_basic',
  'client_secret_post',
  'none',
] as const;

export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED)[number];

// The /token body schemas, one per supported grant type. Only the
// grant-specific validation stage differs between them; client authentication
// and structural validation are shared by the token endpoint itself.
// `client_secret` (RFC 6749 §2.3.1's body-parameter authentication) is
// optional here for the same reason `code_verifier` is required rather than
// present-and-checked at this boundary: which method a client presented is a
// client-authentication rule, not request shape.
export const authorizationCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string(),
  redirect_uri: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
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
