import {
  createClientRequestSchema,
  cursorQuerySchema,
  type Client,
  type CreateClientResponse,
} from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { coerceLimit } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  createClient,
  listClients,
  readClient,
  type Audit,
  type ClientView,
} from '#/usecase/clients';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface ClientsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly tlsClientAuthEnabled: boolean;
  readonly audit: Audit;
}

function toWireClient(view: ClientView): Client {
  return {
    id: view.id,
    client_id: view.clientId,
    name: view.name,
    type: view.type,
    enabled: view.enabled,
    full_scope_allowed: view.fullScopeAllowed,
    registration_origin: view.registrationOrigin,
    created_at: view.createdAt.toISOString(),
    redirect_uris: view.redirectUris,
    grant_types: view.grantTypes,
    token_endpoint_auth_method: view.tokenEndpointAuthMethod,
    audiences: view.audiences,
    access_token_ttl_seconds: view.accessTokenTtlSeconds,
    refresh_token_ttl_seconds: view.refreshTokenTtlSeconds,
    client_credentials_scopes: view.clientCredentialsScopes,
    web_origins: view.webOrigins,
    post_logout_redirect_uris: view.postLogoutRedirectUris,
    jwks: view.jwks,
    jwks_uri: view.jwksUri,
    frontchannel_logout_uri: view.frontchannelLogoutUri,
    backchannel_logout_uri: view.backchannelLogoutUri,
    frontchannel_logout_session_required: view.frontchannelLogoutSessionRequired,
    backchannel_logout_session_required: view.backchannelLogoutSessionRequired,
    consent_required: view.consentRequired,
    token_exchange_impersonation_allowed: view.tokenExchangeImpersonationAllowed,
    userinfo_signed_response_alg: view.userinfoSignedResponseAlg,
    userinfo_encrypted_response_alg: view.userinfoEncryptedResponseAlg,
    userinfo_encrypted_response_enc: view.userinfoEncryptedResponseEnc,
    tls_client_auth_subject_dn: view.tlsClientAuthSubjectDn,
  };
}

export function listClientsHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    // Same narrowing as listTenantsHandler (#/view/routes/tenants.ts):
    // ADMIN_ROUTES' `querystringSchema` already validated shape.
    const query = cursorQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: clients route received no :tenant');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listClients(tx, {
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
    }

    const items = outcome.items.map(toWireClient);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = `/admin/tenants/${tenantName}/clients?limit=${String(limit)}&cursor=${encodeURIComponent(outcome.next)}`;
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function readClientHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET client route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) => readClient(tx, id));
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no client ${id}`),
      );
    }

    const wire = toWireClient(outcome.client);
    reply.header('etag', etagOf(wire));
    return reply.code(200).send(wire);
  };
}

export function createClientHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    // Fastify's ajv compiler already validated `request.body` names a
    // `client_id` and is otherwise a JSON object (ADMIN_ROUTES'
    // `bodySchema`) — `parseClientMetadata` narrows the rest.
    const body = createClientRequestSchema.parse(request.body);
    const { client_id: clientId, ...metadata } = body;

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      createClient(
        tx,
        {
          hashClientSecret: deps.hashClientSecret,
          tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
          audit: deps.audit,
        },
        {
          clientId,
          metadata,
          tenantId: targetTenantId,
          actorSubjectId: principal.subjectId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'reserved_client_id':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the client_id ${JSON.stringify(clientId)} is reserved`,
          ),
        );
      case 'invalid_metadata':
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', outcome.description),
        );
      case 'ok': {
        const wire: CreateClientResponse = {
          ...toWireClient(outcome.client),
          ...(outcome.secret === null ? {} : { client_secret: outcome.secret }),
        };
        return reply.code(201).send(wire);
      }
    }
  };
}
