import {
  amendClientRequestSchema,
  createClientRequestSchema,
  cursorQuerySchema,
  type Client,
  type CreateClientResponse,
  type RotateClientSecretResponse,
} from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { ClientIdConflictError } from '@odudu/domain-tenant';
import { type FastifyReply } from 'fastify';
import { coerceLimit } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  amendClient,
  clientWireShape,
  createClient,
  deleteClient,
  listClients,
  readClient,
  rotateClientSecret,
  type AmendClientOutcome,
  type Audit,
  type ClientView,
  type CreateClientOutcome,
} from '#/usecase/clients';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface ClientsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly tlsClientAuthEnabled: boolean;
  readonly audit: Audit;
}

// `clientWireShape` (usecase/clients.ts) is the one mapping, so the bytes
// this serialises and the bytes `amendClient`'s own `If-Match` check hashes
// can never drift apart.
function toWireClient(view: ClientView): Client {
  return clientWireShape(view) as Client;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
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

    let outcome: CreateClientOutcome;
    try {
      outcome = await withTenant(deps.database, targetTenantId, (tx) =>
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
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught (createClient's own comment on its `create` call) — nothing
      // here reads or writes through `tx` again.
      if (error instanceof ClientIdConflictError) {
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the client_id ${JSON.stringify(clientId)} is already in use`,
          ),
        );
      }
      throw error;
    }

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

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendClientOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    case 'refused_field':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', `${outcome.field}: ${outcome.reason}`),
      );
    case 'invalid_value':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', `${outcome.field}: ${outcome.description}`),
      );
    case 'invalid_metadata':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', outcome.description),
      );
    case 'precondition_required':
      return sendProblem(
        reply,
        request,
        problem(
          428,
          'about:blank',
          'Precondition Required',
          `If-Match is required to amend ${outcome.field}`,
        ),
      );
    case 'precondition_failed':
      return sendProblem(
        reply,
        request,
        problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
      );
    case 'builtin_admin_guarded':
      return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
  }
}

export function amendClientHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH client route received no :id');
    }
    const values = amendClientRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      amendClient(
        tx,
        { tlsClientAuthEnabled: deps.tlsClientAuthEnabled, audit: deps.audit },
        {
          clientDbId: id,
          values,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return amendmentProblem(reply, request, outcome);
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(toWireClient(outcome.client));
  };
}

export function deleteClientHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE client route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteClient(
        tx,
        { audit: deps.audit },
        { clientDbId: id, actorSubjectId: principal.subjectId },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'builtin_admin_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'deleted':
        return reply.code(204).send();
    }
  };
}

export function rotateClientSecretHandler(deps: ClientsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST client secret route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      rotateClientSecret(
        tx,
        { hashClientSecret: deps.hashClientSecret, audit: deps.audit },
        { clientDbId: id, actorSubjectId: principal.subjectId },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'not_confidential':
        return sendProblem(
          reply,
          request,
          problem(409, 'about:blank', 'Conflict', 'a public client has no secret to rotate'),
        );
      case 'ok': {
        const wire: RotateClientSecretResponse = {
          ...toWireClient(outcome.client),
          client_secret: outcome.secret,
        };
        return reply.code(200).send(wire);
      }
    }
  };
}
