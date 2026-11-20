import * as oauth from 'oauth4webapi';
import { signAssertion } from '#/adapter/client-assertion';
import { OduduError } from '#/services/odudu-error';
import { privateKeyOf } from '#/services/client-credentials-request';
import type { ClientAuth, Deps } from '#/types';

const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// How a request to the token endpoint proves the client. Without `auth` the
// client is public and sends only its ID. A secret goes in the Authorization
// header; a key signs an assertion for the token endpoint of the server the
// request goes to.
export function clientAuthentication(auth: ClientAuth | undefined, deps: Deps): oauth.ClientAuth {
  if (auth === undefined) return oauth.None();
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
