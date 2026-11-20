import type { IDToken, TokenEndpointResponse } from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
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
  const entry = {
    accessToken: response.access_token,
    expiresAt: now + (response.expires_in ?? 0) * 1000,
    scope: response.scope ?? '',
  };
  const audiences = resource === undefined ? Object.keys(previous.byAudience) : [resource];
  const refreshToken = response.refresh_token ?? previous.refreshToken;
  return {
    byAudience: {
      ...previous.byAudience,
      ...Object.fromEntries(audiences.map((audience) => [audience, { ...entry }])),
    },
    idToken: response.id_token ?? previous.idToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    claims: claims ?? previous.claims,
    issuer: previous.issuer,
    clientId: previous.clientId,
  };
}
