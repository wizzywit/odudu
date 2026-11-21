import type { IDToken, TokenEndpointResponse } from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
import { expiresAtOf } from '#/services/token-set';
import type { TokenSet } from '#/types';

export function refreshTokenOf(tokens: TokenSet): string {
  if (tokens.refreshToken === undefined) {
    throw new OduduError(
      'invalid_options',
      'these tokens carry no refresh token: sign in with the offline_access scope to get one',
    );
  }
  return tokens.refreshToken;
}

// The tokens after a refresh. Without a `resource` the new access token covers
// every audience the grant carries, so it replaces each entry; with one it
// replaces that audience's entry and leaves the others as they were. A refresh
// token the server did not rotate stays, and so do an ID token and claims it
// did not repeat.
export function refreshedTokenSet(
  previous: TokenSet,
  response: TokenEndpointResponse,
  claims: IDToken | undefined,
  resource: string | undefined,
  now: number,
): TokenSet {
  // OIDC Core section 12.2: a refreshed ID token names the same subject.
  if (claims !== undefined && claims.sub !== previous.claims.sub) {
    throw new OduduError('invalid_id_token', 'the refreshed ID token names another subject');
  }
  const accessToken = response.access_token;
  const expiresAt = expiresAtOf(response, now);
  const audiences = resource === undefined ? Object.keys(previous.byAudience) : [resource];
  const refreshToken = response.refresh_token ?? previous.refreshToken;
  return {
    byAudience: {
      ...previous.byAudience,
      ...Object.fromEntries(
        audiences.map((audience) => [
          audience,
          // A response without `scope` leaves the scope unchanged (RFC 6749 section 5.1).
          {
            accessToken,
            expiresAt,
            scope: response.scope ?? previous.byAudience[audience]?.scope ?? '',
          },
        ]),
      ),
    },
    idToken: response.id_token ?? previous.idToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    claims: claims ?? previous.claims,
    issuer: previous.issuer,
    clientId: previous.clientId,
  };
}
