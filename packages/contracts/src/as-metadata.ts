import { type DiscoveryDocument } from '#/discovery';

// The JWS algorithms a client assertion may use at the token, revocation and
// introspection endpoints. RFC 8414 §2 requires the list wherever
// `private_key_jwt` is advertised, and forbids `none` in it.
export const CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED: readonly string[] = ['RS256', 'ES256'];

// RFC 8414 §2, and the Client ID Metadata Document draft's
// `client_id_metadata_document_supported`, present only when true.
export interface AsMetadataDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly introspection_endpoint: string;
  readonly revocation_endpoint: string;
  readonly response_types_supported: readonly string[];
  readonly response_modes_supported: readonly string[];
  readonly grant_types_supported: readonly string[];
  readonly token_endpoint_auth_methods_supported: readonly string[];
  readonly token_endpoint_auth_signing_alg_values_supported: readonly string[];
  readonly introspection_endpoint_auth_methods_supported: readonly string[];
  readonly introspection_endpoint_auth_signing_alg_values_supported: readonly string[];
  readonly revocation_endpoint_auth_methods_supported: readonly string[];
  readonly revocation_endpoint_auth_signing_alg_values_supported: readonly string[];
  readonly code_challenge_methods_supported: readonly string[];
  readonly authorization_response_iss_parameter_supported: boolean;
  readonly ui_locales_supported: readonly string[];
  readonly scopes_supported?: readonly string[];
  readonly registration_endpoint?: string;
  readonly client_id_metadata_document_supported?: true;
}

// Projected from the discovery document so that what both describe cannot
// drift; only the scope list, which advertises more here, is the caller's.
export function asMetadataDocument(
  discovery: DiscoveryDocument,
  scopesSupported: readonly string[],
  clientIdMetadataDocumentSupported = false,
): AsMetadataDocument {
  return {
    issuer: discovery.issuer,
    authorization_endpoint: discovery.authorization_endpoint,
    token_endpoint: discovery.token_endpoint,
    jwks_uri: discovery.jwks_uri,
    introspection_endpoint: discovery.introspection_endpoint,
    revocation_endpoint: discovery.revocation_endpoint,
    response_types_supported: discovery.response_types_supported,
    response_modes_supported: discovery.response_modes_supported,
    grant_types_supported: discovery.grant_types_supported,
    token_endpoint_auth_methods_supported: discovery.token_endpoint_auth_methods_supported,
    token_endpoint_auth_signing_alg_values_supported: CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    introspection_endpoint_auth_methods_supported:
      discovery.introspection_endpoint_auth_methods_supported,
    introspection_endpoint_auth_signing_alg_values_supported:
      CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    revocation_endpoint_auth_methods_supported:
      discovery.revocation_endpoint_auth_methods_supported,
    revocation_endpoint_auth_signing_alg_values_supported: CLIENT_ASSERTION_SIGNING_ALGS_SUPPORTED,
    code_challenge_methods_supported: discovery.code_challenge_methods_supported,
    authorization_response_iss_parameter_supported:
      discovery.authorization_response_iss_parameter_supported,
    ui_locales_supported: discovery.ui_locales_supported,
    ...(scopesSupported.length > 0 ? { scopes_supported: scopesSupported } : {}),
    ...(discovery.registration_endpoint === undefined
      ? {}
      : { registration_endpoint: discovery.registration_endpoint }),
    ...(clientIdMetadataDocumentSupported ? { client_id_metadata_document_supported: true } : {}),
  };
}
