import type { IDToken, TokenEndpointResponse } from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
import type { Pending, TokenSet } from '#/types';

// When the access token of a code or refresh response expires. A response
// without a lifetime is refused: reading it as zero would hand out a token
// that is already stale.
export function expiresAtOf(response: TokenEndpointResponse, now: number): number {
  if (response.expires_in === undefined) {
    throw new OduduError('request_failed', 'the token response carries no expires_in');
  }
  return now + response.expires_in * 1000;
}

// One token comes back from the token endpoint; it is filed under every
// audience the sign-in asked for, or under the issuer when it named none.
export function tokenSetOf(
  response: TokenEndpointResponse,
  claims: IDToken,
  pending: Pending,
  now: number,
): TokenSet {
  const audiences = pending.resources.length === 0 ? [pending.issuer] : pending.resources;
  const entry = {
    accessToken: response.access_token,
    expiresAt: expiresAtOf(response, now),
    scope: response.scope ?? '',
  };
  return {
    byAudience: Object.fromEntries(audiences.map((audience) => [audience, { ...entry }])),
    idToken: response.id_token ?? '',
    ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
    claims,
    issuer: pending.issuer,
    clientId: pending.clientId,
  };
}
