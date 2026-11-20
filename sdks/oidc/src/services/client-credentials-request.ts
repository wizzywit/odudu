import type { TokenEndpointResponse } from 'oauth4webapi';
import type { AudienceToken, ClientAuth, ClientCredentialsOptions, PrivateKeyJwk } from '#/types';
import { OduduError } from '#/services/odudu-error';

// The server accepts an assertion that expires at most 300 s ahead
// (MAX_ASSERTION_LIFETIME_SECONDS in packages/protocol-oidc). 120 s leaves room
// for a service clock that runs behind the server's; one more than that behind
// gets `invalid_client`.
const ASSERTION_LIFETIME_SECONDS = 120;

// What a token is assumed to live when the response omits `expires_in`.
export const DEFAULT_LIFETIME_SECONDS = 60;

// The types already rule these out; a JavaScript caller is held to them here.
export function checkedOptions(options: ClientCredentialsOptions): ClientCredentialsOptions {
  const auth: { secret?: unknown; privateKey?: { kty?: unknown } } = options.auth;
  if (options.issuer === '' || options.clientId === '') {
    throw new OduduError('invalid_options', 'the issuer and the client ID are required');
  }
  if (auth.secret !== undefined && auth.privateKey !== undefined) {
    throw new OduduError('invalid_options', 'auth takes a secret or a private key, not both');
  }
  if (typeof auth.secret === 'string' && auth.secret !== '') return options;
  if (typeof auth.privateKey?.kty === 'string') return options;
  throw new OduduError(
    'invalid_options',
    'auth needs a non-empty secret or a private key in JWK form',
  );
}

export function grantParameters(options: ClientCredentialsOptions): URLSearchParams {
  const parameters = new URLSearchParams();
  if (options.scope !== undefined) parameters.set('scope', options.scope);
  if (options.resource !== undefined) parameters.set('resource', options.resource);
  return parameters;
}

// The algorithm a key signs with when the caller names none.
export function assertionAlgorithm(key: PrivateKeyJwk, alg: string | undefined): string {
  if (alg !== undefined) return alg;
  const byCurve: Record<string, string> = { 'P-256': 'ES256', 'P-384': 'ES384', 'P-521': 'ES512' };
  if (key.kty === 'RSA') return 'RS256';
  const fromCurve = key.kty === 'EC' && key.crv !== undefined ? byCurve[key.crv] : undefined;
  if (fromCurve === undefined) {
    throw new OduduError(
      'invalid_options',
      'cannot tell which algorithm this key signs with: pass auth.alg',
    );
  }
  return fromCurve;
}

// OIDC Core section 9: `iss` and `sub` are the client, `aud` is the token
// endpoint, which is what the server compares it to.
export function assertionClaims(
  clientId: string,
  tokenEndpoint: string,
  jti: string,
  nowSeconds: number,
): Record<string, string | number> {
  return {
    iss: clientId,
    sub: clientId,
    aud: tokenEndpoint,
    jti,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
  };
}

export function privateKeyOf(
  auth: ClientAuth,
): { key: PrivateKeyJwk; kid?: string; alg?: string } | undefined {
  return auth.privateKey === undefined
    ? undefined
    : {
        key: auth.privateKey,
        ...(auth.kid === undefined ? {} : { kid: auth.kid }),
        ...(auth.alg === undefined ? {} : { alg: auth.alg }),
      };
}

// A response without `expires_in` is taken to live 60 s. A response without `scope` grants what was asked for (RFC 6749 section 5.1).
export function audienceTokenOf(
  response: TokenEndpointResponse,
  requestedScope: string | undefined,
  now: number,
): AudienceToken {
  return {
    accessToken: response.access_token,
    expiresAt: now + (response.expires_in ?? DEFAULT_LIFETIME_SECONDS) * 1000,
    scope: response.scope ?? requestedScope ?? '',
  };
}
