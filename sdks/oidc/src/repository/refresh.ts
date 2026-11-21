import { refreshGrant } from '#/adapter/refresh';
import { refreshedTokenSet, refreshTokenOf } from '#/services/refresh-request';
import { idTokenAlgOf } from '#/services/sign-in-request';
import { SingleFlight } from '#/services/single-flight';
import type { Deps, RefreshOptions, ServerMetadata, TokenSet } from '#/types';

const flights = new SingleFlight<TokenSet>((tokens) =>
  tokens.refreshToken === undefined ? [] : [tokens.refreshToken],
);

// Renews the tokens. A rotating server refuses a refresh token it has already
// seen, and revokes the grant when it does, so the refreshes of one grant run
// one at a time: callers for the same audience share a request, and any other
// caller runs after it with the newest tokens that came back, however old the
// tokens it holds.
export function refreshTokens(
  metadata: ServerMetadata,
  tokens: TokenSet,
  options: RefreshOptions,
  deps: Deps,
): Promise<TokenSet> {
  return flights.run(refreshTokenOf(tokens), options.resource ?? '', async (latest) => {
    const previous = latest ?? tokens;
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
