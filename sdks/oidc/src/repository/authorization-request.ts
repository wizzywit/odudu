import { authorizationUrl, newSecrets } from '#/adapter/authorize';
import { idTokenAlgOf, resourcesOf, scopeOf } from '#/services/sign-in-request';
import type { Pending, ServerMetadata, SignInOptions } from '#/types';

export async function buildAuthorizationRequest(
  metadata: ServerMetadata,
  options: SignInOptions,
  silent = false,
): Promise<{ url: string; pending: Pending }> {
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
