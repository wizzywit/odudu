import { refreshTokens } from '#/repository/refresh';
import { checkResource } from '#/services/refresh-request';
import { discover } from '#/use-cases/discover';
import type { Deps, RefreshOptions, TokenSet } from '#/types';

// Renews the access tokens of a sign-in; client and issuer come from `tokens`.
// Calls with one refresh token and one resource share a request, and a call
// naming another resource waits and continues with the rotated refresh token.
// Keep the result, not `tokens`. Without `resource` only the audiences the new
// access token names are kept (best effort: it is opaque to a client). A
// `resource` the sign-in did not carry rejects with `audience_not_granted`.
export async function refresh(
  tokens: TokenSet,
  options: RefreshOptions = {},
  deps: Deps = {},
): Promise<TokenSet> {
  checkResource(tokens, options.resource);
  const metadata = await discover(tokens.issuer, deps);
  return refreshTokens(metadata, tokens, options, deps);
}
