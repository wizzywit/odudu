import { checkSkew, tokenRenewer } from '#/services/token-renewer';
import { clientCredentials } from '#/use-cases/client-credentials';
import type { Deps, TokenSourceOptions } from '#/types';

const DEFAULT_SKEW_MS = 30_000;

// A function that returns a valid access token for the client, asking the
// server again only when the one it holds is within `skewMs` of expiring.
// Concurrent calls share one request. Call it before every request to the API.
export function createTokenSource(
  options: TokenSourceOptions,
  deps: Deps = {},
): () => Promise<string> {
  const { skewMs = DEFAULT_SKEW_MS, ...grant } = options;
  return tokenRenewer(
    () => clientCredentials(grant, deps),
    deps.now ?? Date.now,
    checkSkew(skewMs),
  );
}
