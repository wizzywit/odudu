import type { IDToken, TokenEndpointResponse } from 'oauth4webapi';
import type { Pending, TokenSet } from '#/types';

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
    expiresAt: now + (response.expires_in ?? 0) * 1000,
    scope: response.scope ?? '',
  };
  return {
    byAudience: Object.fromEntries(audiences.map((audience) => [audience, { ...entry }])),
    idToken: response.id_token ?? '',
    ...(response.refresh_token === undefined ? {} : { refreshToken: response.refresh_token }),
    claims,
  };
}
