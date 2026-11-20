import { refreshTokens } from '#/repository/refresh';
import { issuerOf } from '#/services/refresh-request';
import { discover } from '#/use-cases/discover';
import type { Deps, RefreshOptions, TokenSet } from '#/types';

// Renews the access tokens of a sign-in. The client and the issuer are read
// from the ID token in `tokens`. Concurrent calls with one refresh token make
// one request and share its result or its error. A rotated refresh token
// replaces the old one in the result; keep the result, not `tokens`.
//
// Without `resource` every audience of the sign-in is renewed. A `resource` the
// sign-in did not carry rejects with `audience_not_granted`. Whether two
// concurrent calls naming different resources are safe on a rotating server is
// untested, so make them one after the other.
export async function refresh(
  tokens: TokenSet,
  options: RefreshOptions = {},
  deps: Deps = {},
): Promise<TokenSet> {
  const metadata = await discover(issuerOf(tokens.claims), deps);
  return refreshTokens(metadata, tokens, options, deps);
}
