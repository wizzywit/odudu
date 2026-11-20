import * as oauth from 'oauth4webapi';
import { requestOptions } from '#/adapter/discovery';
import { signAssertion } from '#/adapter/client-assertion';
import { fromServerError, OduduError } from '#/services/odudu-error';
import { privateKeyOf } from '#/services/client-credentials-request';
import type { ClientAuth, Deps, ServerMetadata } from '#/types';

const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// A secret goes in the Authorization header; a key signs an assertion for the
// token endpoint of the server the request goes to.
function authentication(auth: ClientAuth, deps: Deps): oauth.ClientAuth {
  const signing = privateKeyOf(auth);
  if (signing === undefined) return oauth.ClientSecretBasic(auth.secret ?? '');
  return async (metadata, client, body) => {
    const endpoint = metadata.token_endpoint;
    if (endpoint === undefined) {
      throw new OduduError('discovery_failed', 'the metadata names no token endpoint');
    }
    const now = Math.floor((deps.now ?? Date.now)() / 1000);
    body.set('client_id', client.client_id);
    body.set('client_assertion_type', ASSERTION_TYPE);
    body.set('client_assertion', await signAssertion(signing, client.client_id, endpoint, now));
  };
}

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
    return await oauth.processClientCredentialsResponse(
      metadata,
      client,
      await oauth.clientCredentialsGrantRequest(
        metadata,
        client,
        authentication(auth, deps),
        parameters,
        requestOptions(deps),
      ),
    );
  } catch (cause) {
    if (cause instanceof OduduError) throw cause;
    if (cause instanceof oauth.ResponseBodyError) {
      throw fromServerError(
        cause.error,
        cause.error_description,
        'the token endpoint refused the client',
      );
    }
    throw new OduduError('request_failed', 'the token request did not complete', { cause });
  }
}
