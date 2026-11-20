import { signClientAssertion } from '@odudu-io/oidc';
import type { ClientKey } from '#/service/client-key';
import { CLIENT_KEY_ALG } from '#/service/client-key';

// The private_key_jwt assertion that proves the service account at the token
// endpoint it is sent to.
export function clientAssertion(
  key: ClientKey,
  input: { clientId: string; audience: string; now: Date },
): Promise<string> {
  return signClientAssertion({
    clientId: input.clientId,
    audience: input.audience,
    privateKey: key.privateJwk,
    kid: key.kid,
    alg: CLIENT_KEY_ALG,
    now: input.now.getTime(),
  });
}
