import { checkOptions, requestClientToken } from '#/repository/client-credentials';
import { discover } from '#/use-cases/discover';
import type { AudienceToken, ClientCredentialsOptions, Deps } from '#/types';

// Signs in as the client itself (RFC 6749 section 4.4): a service with no
// person behind it. Authenticates with a secret (`client_secret_basic`) or
// with a private key (`private_key_jwt`).
export async function clientCredentials(
  options: ClientCredentialsOptions,
  deps: Deps = {},
): Promise<AudienceToken> {
  const checked = checkOptions(options);
  return requestClientToken(await discover(checked.issuer, deps), checked, deps);
}
