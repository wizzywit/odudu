import { exchangeCode } from '#/adapter/token-exchange';
import { tokenSetOf } from '#/services/token-set';
import type { ClientAuth, Deps, Pending, ServerMetadata, TokenSet } from '#/types';

export async function exchangeForTokens(
  metadata: ServerMetadata,
  params: URLSearchParams,
  pending: Pending,
  deps: Deps,
  auth?: ClientAuth,
): Promise<TokenSet> {
  // Read before the request: a slow answer must not lengthen the token's life.
  const requestedAt = (deps.now ?? Date.now)();
  const { response, claims } = await exchangeCode(metadata, params, pending, deps, auth);
  return tokenSetOf(response, claims, pending, requestedAt);
}
