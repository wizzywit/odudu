import { refreshGrant } from '#/adapter/refresh';
import {
  clientIdOf,
  flightKey,
  refreshedTokenSet,
  refreshTokenOf,
} from '#/services/refresh-request';
import { idTokenAlgOf } from '#/services/sign-in-request';
import { SingleFlight } from '#/services/single-flight';
import type { Deps, RefreshOptions, ServerMetadata, TokenSet } from '#/types';

const flights = new SingleFlight<TokenSet>();

// Renews the tokens. Callers that present the same refresh token for the same
// audience while a request is out share it: a rotating server would refuse the
// second use of one token, so only one request may spend it.
export function refreshTokens(
  metadata: ServerMetadata,
  tokens: TokenSet,
  options: RefreshOptions,
  deps: Deps,
): Promise<TokenSet> {
  const refreshToken = refreshTokenOf(tokens);
  const client = {
    client_id: clientIdOf(tokens.claims),
    id_token_signed_response_alg: idTokenAlgOf(options),
  };
  return flights.run(flightKey(refreshToken, options.resource), async () => {
    const { response, claims } = await refreshGrant(
      metadata,
      client,
      refreshToken,
      options.resource,
      deps,
    );
    return refreshedTokenSet(tokens, response, claims, options.resource, (deps.now ?? Date.now)());
  });
}
