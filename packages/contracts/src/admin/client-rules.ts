import { TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED } from '#/token';

// What a client may be configured with, stated once for the server's
// validators, the database's CHECK constraints (whose tests hold them in
// agreement) and every caller that offers a choice.

export const CLIENT_GRANT_TYPES = [
  'authorization_code',
  'refresh_token',
  'client_credentials',
  'urn:ietf:params:oauth:grant-type:token-exchange',
] as const;

export const CLIENT_AUTH_METHODS = TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED;

export const USERINFO_SIGNING_ALGS = ['RS256', 'ES256', 'none'] as const;

// `none` is refused: an ID token is the client's proof of who authenticated.
export const ID_TOKEN_SIGNING_ALGS = ['RS256', 'ES256'] as const;

export const USERINFO_ENCRYPTION_ALGS = [
  'RSA-OAEP-256',
  'ECDH-ES',
  'ECDH-ES+A128KW',
  'ECDH-ES+A192KW',
  'ECDH-ES+A256KW',
] as const;

export const USERINFO_ENCRYPTION_ENCS = [
  'A128CBC-HS256',
  'A192CBC-HS384',
  'A256CBC-HS512',
  'A128GCM',
  'A192GCM',
  'A256GCM',
] as const;

// Registered with an algorithm and no `enc`, the content encryption is this.
export const USERINFO_ENCRYPTION_ENC_DEFAULT = 'A128CBC-HS256';

// PostgreSQL `integer`: a larger value fails as out of range.
export const INTEGER_CEILING = 2_147_483_647;

export const DEFAULT_MAX_AGE_MAX = INTEGER_CEILING;

export interface ClientTokenTtlRange {
  min: number;
  /** Omitted, the column's own integer ceiling. */
  max?: number;
}

export type ClientTokenTtlField =
  'access_token_ttl_seconds' | 'id_token_ttl_seconds' | 'refresh_token_ttl_seconds';

export const CLIENT_TOKEN_TTL_RANGES: Readonly<Record<ClientTokenTtlField, ClientTokenTtlRange>> = {
  access_token_ttl_seconds: { min: 1, max: 3600 },
  id_token_ttl_seconds: { min: 1, max: 3600 },
  refresh_token_ttl_seconds: { min: 1 },
};
