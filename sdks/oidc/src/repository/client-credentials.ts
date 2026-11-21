import { clientCredentialsGrant } from '#/adapter/client-credentials';
import {
  audienceTokenOf,
  checkedOptions,
  grantParameters,
} from '#/services/client-credentials-request';
import type { AudienceToken, ClientCredentialsOptions, Deps, ServerMetadata } from '#/types';

export function checkOptions(options: ClientCredentialsOptions): ClientCredentialsOptions {
  return checkedOptions(options);
}

export async function requestClientToken(
  metadata: ServerMetadata,
  options: ClientCredentialsOptions,
  deps: Deps,
): Promise<AudienceToken> {
  // Read before the request: a slow answer must not lengthen the token's life.
  const requestedAt = (deps.now ?? Date.now)();
  const response = await clientCredentialsGrant(
    metadata,
    options.clientId,
    options.auth,
    grantParameters(options),
    deps,
  );
  return audienceTokenOf(response, options.scope, requestedAt);
}
