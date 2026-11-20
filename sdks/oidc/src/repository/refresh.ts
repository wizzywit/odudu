import { refreshGrant } from '#/adapter/refresh';
import { refreshedTokenSet, refreshTokenOf } from '#/services/refresh-request';
import { idTokenAlgOf } from '#/services/sign-in-request';
import { SingleFlight } from '#/services/single-flight';
import type { Deps, RefreshOptions, ServerMetadata, TokenSet } from '#/types';

const flights = new SingleFlight<TokenSet>();

// Renews the tokens. A rotating server refuses a refresh token it has already
// seen, so one refresh token is spent by one request at a time: callers for the
// same audience share it, and a caller for another audience runs after it with
// the token it returned.
export function refreshTokens(
  metadata: ServerMetadata,
  tokens: TokenSet,
  options: RefreshOptions,
  deps: Deps,
): Promise<TokenSet> {
  return flights.run(refreshTokenOf(tokens), options.resource ?? '', async (after) => {
    const previous = after ?? tokens;
    const { response, claims } = await refreshGrant(
      metadata,
      { client_id: previous.clientId, id_token_signed_response_alg: idTokenAlgOf(options) },
      refreshTokenOf(previous),
      options.resource,
      deps,
      options.auth,
    );
    return refreshedTokenSet(
      previous,
      response,
      claims,
      options.resource,
      (deps.now ?? Date.now)(),
    );
  });
}
