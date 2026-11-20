import { signClientAssertionFor } from '#/repository/client-assertion';
import { OduduError } from '#/services/odudu-error';
import type { PrivateKeyJwk } from '#/types';

export interface ClientAssertionOptions {
  clientId: string;
  // The token endpoint the assertion is presented to.
  audience: string;
  privateKey: PrivateKeyJwk;
  kid?: string;
  alg?: string;
  // Milliseconds since the epoch; the current time when omitted.
  now?: number;
}

// The `private_key_jwt` assertion for a client that makes its own token
// request, for the caller whose request cannot go through `clientCredentials`.
export async function signClientAssertion(options: ClientAssertionOptions): Promise<string> {
  if (options.clientId === '' || options.audience === '') {
    throw new OduduError('invalid_options', 'the client ID and the audience are required');
  }
  return await signClientAssertionFor(
    {
      key: options.privateKey,
      ...(options.kid === undefined ? {} : { kid: options.kid }),
      ...(options.alg === undefined ? {} : { alg: options.alg }),
    },
    options.clientId,
    options.audience,
    Math.floor((options.now ?? Date.now()) / 1000),
  );
}
