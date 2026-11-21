import { authorizationUrl, newSecrets } from '#/adapter/authorize';
import { idTokenAlgOf, resourcesOf, scopeOf } from '#/services/sign-in-request';
import type { Pending, ServerMetadata, SignInOptions } from '#/types';

export async function buildAuthorizationRequest(
  metadata: ServerMetadata,
  given: SignInOptions,
  silent = false,
): Promise<{ url: string; pending: Pending }> {
  // The PKCE challenge is awaited, so the options are copied once, here, arrays included: the
  // address and the record then agree whatever the caller does meanwhile.
  const options = structuredClone(given);
  const secrets = newSecrets();
  const resources = resourcesOf(options);
  const url = await authorizationUrl(
    metadata,
    options,
    secrets,
    scopeOf(options),
    resources,
    silent,
  );
  return {
    url,
    pending: {
      issuer: options.issuer,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      ...secrets,
      resources,
      idTokenAlg: idTokenAlgOf(options),
    },
  };
}
