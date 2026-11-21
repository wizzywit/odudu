import { refreshTokens } from '#/repository/refresh';
import { checkResource } from '#/services/refresh-request';
import { discover } from '#/use-cases/discover';
import type { Deps, RefreshOptions, TokenSet } from '#/types';

// Renews the access tokens of a sign-in. The client and the issuer are read
// from `tokens`. Concurrent calls with one refresh token and one resource make
// one request and share its result or its error; a call naming another resource
// waits for it and continues with the rotated refresh token. A rotated refresh
// token replaces the old one in the result; keep the result, not `tokens`.
//
// Without `resource` every audience of the sign-in is renewed. A `resource` the
// sign-in did not carry rejects with `audience_not_granted`, without a request.
export async function refresh(
  tokens: TokenSet,
  options: RefreshOptions = {},
  deps: Deps = {},
): Promise<TokenSet> {
  checkResource(tokens, options.resource);
  const metadata = await discover(tokens.issuer, deps);
  return refreshTokens(metadata, tokens, options, deps);
}
