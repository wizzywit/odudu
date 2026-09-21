import { type FastifyInstance } from 'fastify';
import {
  registerClient,
  type ClientRegistrationDeps,
  type RegisteredClient,
} from '#/usecase/client-registration';

const PATH = '/realms/:realm/clients-registrations/openid-connect';

// RFC 7591 §3.2.1: every field the server actually understood is echoed
// back, so a client can tell what it registered from what it asked for.
// Optional members are omitted rather than sent null — the same convention
// `@odudu/contracts`' discoveryDocument uses for scopes_supported and
// claims_supported.
function toResponseBody(client: RegisteredClient): Record<string, unknown> {
  const { metadata } = client;
  return {
    client_id: client.clientId,
    client_id_issued_at: client.clientIdIssuedAt,
    ...(client.clientSecret === null
      ? {}
      : { client_secret: client.clientSecret, client_secret_expires_at: 0 }),
    redirect_uris: metadata.redirectUris,
    grant_types: metadata.grantTypes,
    token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
    ...(metadata.clientName === null ? {} : { client_name: metadata.clientName }),
    ...(metadata.jwks === null ? {} : { jwks: metadata.jwks }),
    ...(metadata.jwksUri === null ? {} : { jwks_uri: metadata.jwksUri }),
    ...(metadata.frontchannelLogoutUri === null
      ? {}
      : {
          frontchannel_logout_uri: metadata.frontchannelLogoutUri,
          frontchannel_logout_session_required: metadata.frontchannelLogoutSessionRequired,
        }),
    ...(metadata.backchannelLogoutUri === null
      ? {}
      : {
          backchannel_logout_uri: metadata.backchannelLogoutUri,
          backchannel_logout_session_required: metadata.backchannelLogoutSessionRequired,
        }),
    ...(metadata.userinfoSignedResponseAlg === null
      ? {}
      : { userinfo_signed_response_alg: metadata.userinfoSignedResponseAlg }),
    ...(metadata.userinfoEncryptedResponseAlg === null
      ? {}
      : { userinfo_encrypted_response_alg: metadata.userinfoEncryptedResponseAlg }),
    ...(metadata.userinfoEncryptedResponseEnc === null
      ? {}
      : { userinfo_encrypted_response_enc: metadata.userinfoEncryptedResponseEnc }),
    ...(metadata.tlsClientAuthSubjectDn === null
      ? {}
      : { tls_client_auth_subject_dn: metadata.tlsClientAuthSubjectDn }),
  };
}

const BEARER_CHALLENGE = 'Bearer realm="client-registration"';

export function registerClientRegistrationRoute(
  app: FastifyInstance,
  deps: ClientRegistrationDeps,
): void {
  app.post<{ Params: { realm: string } }>(PATH, async (request, reply) => {
    const outcome = await registerClient(
      deps,
      request.params.realm,
      request.headers.authorization,
      request.body,
    );

    switch (outcome.kind) {
      // A disabled realm answers exactly like an unknown one: distinguishing
      // "exists but closed" from "does not exist" is an enumeration oracle
      // for nothing gained (ADR 0026).
      case 'not_found':
        return reply.code(404).send();
      case 'unauthorized':
        return reply.code(401).header('www-authenticate', BEARER_CHALLENGE).send();
      case 'invalid_token':
        return reply
          .code(401)
          .header('www-authenticate', `${BEARER_CHALLENGE}, error="invalid_token"`)
          .send();
      case 'invalid_metadata':
        return reply
          .code(400)
          .send({ error: outcome.error, error_description: outcome.description });
      // RFC 7591 §3.2.2 has no error code of its own for a realm at its
      // client cap; invalid_client_metadata is the closest fit — the
      // request is refused for a property of the realm's state, not a
      // malformed field, but the response shape is the same one a client
      // already has to handle.
      case 'at_capacity':
        return reply.code(403).send({
          error: 'invalid_client_metadata',
          error_description: 'this realm has reached its client registration limit',
        });
      case 'ok':
        return reply.code(201).send(toResponseBody(outcome.client));
    }
  });
}

export { PATH as CLIENT_REGISTRATION_PATH };
