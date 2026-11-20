import * as oauth from 'oauth4webapi';
import { requestOptions } from '#/adapter/discovery';
import { fromServerError, OduduError } from '#/services/odudu-error';
import type { Deps, IdTokenClaims, Pending, ServerMetadata } from '#/types';

interface Exchanged {
  response: oauth.TokenEndpointResponse;
  claims: IdTokenClaims;
}

function failure(cause: unknown): OduduError {
  if (cause instanceof oauth.ResponseBodyError) {
    return fromServerError(
      cause.error,
      cause.error_description,
      'the token endpoint refused the code',
    );
  }
  if (cause instanceof oauth.OperationProcessingError) {
    return new OduduError('invalid_id_token', `the response was refused: ${cause.message}`, {
      cause,
    });
  }
  return new OduduError('request_failed', 'the token request did not complete', { cause });
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
        oauth.None(),
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
    throw cause instanceof OduduError ? cause : failure(cause);
  }
}
