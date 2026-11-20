import type { TokenSet } from '@odudu-io/oidc';
import type { Upstream } from '#/types';

export type AccessToken =
  | { kind: 'token'; value: string }
  // The sign-in did not carry the upstream's audience.
  | { kind: 'not-granted' }
  // The token is past its expiry and no refresh token renewed it.
  | { kind: 'expired' };

// The access token a call to the upstream carries: the one for its audience,
// or for the issuer's own when the upstream names none.
export function accessTokenFor(tokens: TokenSet, upstream: Upstream, now: number): AccessToken {
  const token = tokens.byAudience[upstream.resource ?? tokens.issuer];
  if (token === undefined) return { kind: 'not-granted' };
  return token.expiresAt > now ? { kind: 'token', value: token.accessToken } : { kind: 'expired' };
}
