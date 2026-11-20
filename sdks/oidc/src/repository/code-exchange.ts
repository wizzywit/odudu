import { exchangeCode } from '#/adapter/token-exchange';
import { tokenSetOf } from '#/services/token-set';
import type { Deps, Pending, ServerMetadata, TokenSet } from '#/types';

export async function exchangeForTokens(
  metadata: ServerMetadata,
  params: URLSearchParams,
  pending: Pending,
  deps: Deps,
): Promise<TokenSet> {
  const { response, claims } = await exchangeCode(metadata, params, pending, deps);
  return tokenSetOf(response, claims, pending, (deps.now ?? Date.now)());
}
