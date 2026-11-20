import * as oauth from 'oauth4webapi';
import { clientAuthentication } from '#/adapter/client-authentication';
import { requestOptions } from '#/adapter/discovery';
import { tokenFailure } from '#/adapter/token-failure';
import { OduduError } from '#/services/odudu-error';
import type { ClientAuth, Deps, IdTokenClaims, ServerMetadata } from '#/types';

interface Refreshed {
  response: oauth.TokenEndpointResponse;
  claims: IdTokenClaims | undefined;
}

// One refresh_token grant. `resource` goes to the token endpoint (RFC 8707
// section 2.2) and the scope is left out, so the grant's own is kept. An ID
// token the server repeats is checked like the one of the sign-in.
export async function refreshGrant(
  metadata: ServerMetadata,
  client: oauth.Client,
  refreshToken: string,
  resource: string | undefined,
  deps: Deps,
  auth?: ClientAuth,
): Promise<Refreshed> {
  const options = requestOptions(deps);
  try {
    const response = await oauth.processRefreshTokenResponse(
      metadata,
      client,
      await oauth.refreshTokenGrantRequest(
        metadata,
        client,
        clientAuthentication(auth, deps),
        refreshToken,
        {
          ...(resource === undefined ? {} : { additionalParameters: { resource } }),
          ...options,
        },
      ),
    );
    return { response, claims: oauth.getValidatedIdTokenClaims(response) };
  } catch (cause) {
    if (cause instanceof oauth.ResponseBodyError && cause.error === 'invalid_target') {
      throw new OduduError(
        'audience_not_granted',
        'the grant does not carry this audience: use requestAudience to ask for it',
        { error: cause.error, ...detail(cause.error_description) },
      );
    }
    throw tokenFailure(cause, 'the token endpoint refused the refresh token');
  }
}

function detail(description: string | undefined): { errorDescription?: string } {
  return description === undefined ? {} : { errorDescription: description };
}
