import * as oauth from 'oauth4webapi';
import { requestOptions } from '#/adapter/discovery';
import { clientAuthentication } from '#/adapter/client-authentication';
import { tokenFailure } from '#/adapter/token-failure';
import { OduduError } from '#/services/odudu-error';
import { withUsableLifetime } from '#/services/client-credentials-request';
import type { ClientAuth, Deps, ServerMetadata } from '#/types';

// One client_credentials grant.
export async function clientCredentialsGrant(
  metadata: ServerMetadata,
  clientId: string,
  auth: ClientAuth,
  parameters: URLSearchParams,
  deps: Deps,
): Promise<oauth.TokenEndpointResponse> {
  const client: oauth.Client = { client_id: clientId };
  try {
    const response = await oauth.clientCredentialsGrantRequest(
      metadata,
      client,
      clientAuthentication(auth, deps),
      parameters,
      requestOptions(deps),
    );
    return await oauth.processClientCredentialsResponse(
      metadata,
      client,
      await readableLifetime(response),
    );
  } catch (cause) {
    if (cause instanceof OduduError) throw cause;
    throw await clientTokenFailure(cause);
  }
}

// A refused client is named by the server's code; anything else did not complete.
async function clientTokenFailure(cause: unknown): Promise<OduduError> {
  const failure = await tokenFailure(cause, 'the token endpoint refused the client');
  return failure.code === 'invalid_id_token'
    ? new OduduError('request_failed', 'the token request did not complete', { cause })
    : failure;
}

// oauth4webapi refuses a response whose `expires_in` is not a non-negative
// number. A service that gets one anyway is better served by the default
// lifetime than by a failure, so the field is dropped before the library
// reads the response.
async function readableLifetime(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const usable = withUsableLifetime(body);
  return usable === body
    ? response
    : new Response(JSON.stringify(usable), { status: response.status, headers: response.headers });
}
