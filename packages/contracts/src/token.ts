// The one list of client authentication methods Odudu's token endpoint
// honours, shared with client-oidc-config's stored value and discovery's
// advertisement so all three cannot drift apart: whatever a client can be
// configured to use is exactly what the endpoint accepts and discovery
// names.
export const TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED = [
  'client_secret_basic',
  'client_secret_post',
  'none',
  'private_key_jwt',
  'tls_client_auth',
] as const;

export type TokenEndpointAuthMethod = (typeof TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED)[number];
