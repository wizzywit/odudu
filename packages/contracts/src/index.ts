export {
  discoveryDocument,
  SUPPORTED_SCOPES,
  type DiscoveryDocument,
  type DiscoveryDocumentOptions,
} from '#/discovery';
export { authorizeQuerySchema, type AuthorizeQuery } from '#/authorize';
export {
  authorizationCodeGrantSchema,
  refreshTokenGrantSchema,
  clientCredentialsGrantSchema,
  tokenRequestSchema,
  TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED,
  type TokenRequest,
  type TokenEndpointAuthMethod,
} from '#/token';
