import * as oauth from 'oauth4webapi';
import { clientAuthentication } from '#/adapter/client-authentication';
import { requestOptions } from '#/adapter/discovery';
import { tokenFailure } from '#/adapter/token-failure';
import { OduduError } from '#/services/odudu-error';
import type { ClientAuth, Deps, IdTokenClaims, Pending, ServerMetadata } from '#/types';

interface Exchanged {
  response: oauth.TokenEndpointResponse;
  claims: IdTokenClaims;
}

// Exchanges the code and checks the ID token the server returns: issuer,
// audience, `azp`, expiry and nonce. Its signature is not checked: the token
// comes straight from the token endpoint over TLS, which OIDC Core section
// 3.1.3.7 accepts in place of a signature check.
export async function exchangeCode(
  metadata: ServerMetadata,
  params: URLSearchParams,
  pending: Pending,
  deps: Deps,
  auth?: ClientAuth,
): Promise<Exchanged> {
  const client: oauth.Client = {
    client_id: pending.clientId,
    id_token_signed_response_alg: pending.idTokenAlg,
  };
  const options = requestOptions(deps);
  try {
    const response = await oauth.processAuthorizationCodeResponse(
      metadata,
      client,
      await oauth.authorizationCodeGrantRequest(
        metadata,
        client,
        clientAuthentication(auth, deps),
        // Only a value this library has validated is accepted for the exchange;
        // readCallback has already refused everything it would.
        oauth.validateAuthResponse(metadata, client, params, pending.state),
        pending.redirectUri,
        pending.codeVerifier,
        options,
      ),
      { expectedNonce: pending.nonce, requireIdToken: true, ...options },
    );
    const claims = oauth.getValidatedIdTokenClaims(response);
    if (claims === undefined)
      throw new OduduError('invalid_id_token', 'the response has no ID token');
    return { response, claims };
  } catch (cause) {
    throw cause instanceof OduduError
      ? cause
      : tokenFailure(cause, 'the token endpoint refused the code');
  }
}
