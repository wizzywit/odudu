import {
  amendScopeRequestSchema,
  assignScopeToClientRequestSchema,
  createScopeRequestSchema,
  listScopeClientsQuerySchema,
  listScopesQuerySchema,
  setScopeRolesRequestSchema,
  type ClientScope,
  type SetScopeRolesResponse,
} from '@odudu/contracts/admin';
import { isUniqueViolation, type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import { DefaultScopeLimitError } from '@odudu/domain-tenant';
import {
  amendScope,
  assignScopeToClient,
  createScope,
  deleteScope,
  listScopeClients,
  listScopes,
  readScope,
  readScopeRoles,
  ScopeLimitError,
  setScopeRoles,
  unassignScopeFromClient,
  type AmendScopeOutcome,
  type Audit,
} from '#/usecase/scopes';
import {
  ceilingProblem,
  cursorProblem,
  fieldProblem,
  ifMatchRequired,
  ifMatchStale,
  problem,
  sendProblem,
} from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { serviceAccountCeilingProblem } from '#/view/routes/clients';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface ScopesRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  /** See `SubjectsRouteDeps.callerCapabilities` (#/view/routes/subjects.ts) — the same ceiling. */
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function listScopesHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listScopesQuerySchema.parse(request.query);
    const { cursor, limit: requestedLimit, ...filters } = query;
    const limit = coerceLimit(requestedLimit === undefined ? undefined : String(requestedLimit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: scopes route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listScopes(tx, {
        limit,
        cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
        filters,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
    }

    if (outcome.next === null) {
      return reply.code(200).send({ items: outcome.items });
    }
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/scopes`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function readScopeHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET scope route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readScope(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
      );
    }

    reply.header('etag', etagOf(outcome.scope));
    return reply.code(200).send(outcome.scope);
  };
}

export function createScopeHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createScopeRequestSchema.parse(request.body);

    let scope: ClientScope;
    try {
      scope = await adminTx(deps.database, request, targetTenantId, (tx) =>
        createScope(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            description: body.description ?? null,
            includeInIdToken: body.include_in_id_token,
            includeInAccessToken: body.include_in_access_token,
            defaultClientAssignment: body.default_client_assignment ?? null,
            consentText: body.consent_text ?? null,
            displayOrder: body.display_order ?? 0,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught — see the comment beside `createScope`'s own call
      // (#/usecase/scopes.ts).
      if (error instanceof ScopeLimitError || error instanceof DefaultScopeLimitError) {
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', error.message));
      }
      if (isUniqueViolation(error)) {
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the name ${JSON.stringify(body.name)} is already in use`,
          ),
        );
      }
      throw error;
    }

    reply.header('etag', etagOf(scope));
    return reply.code(201).send(scope);
  };
}

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendScopeOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    case 'refused_field':
      return sendProblem(
        reply,
        request,
        fieldProblem([{ path: outcome.field, message: outcome.reason }]),
      );
    case 'invalid_value':
      return sendProblem(
        reply,
        request,
        fieldProblem([{ path: outcome.field, message: outcome.description }]),
      );
    case 'precondition_failed':
      return sendProblem(
        reply,
        request,
        problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
      );
    case 'default_scope_limit':
      return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.message));
  }
}

export function amendScopeHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH scope route received no :id');
    }
    const values = amendScopeRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      amendScope(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          values,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return amendmentProblem(reply, request, outcome);
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.scope);
  };
}

export function deleteScopeHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE scope route received no :id');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteScope(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'openid_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'capability_ceiling':
        return sendProblem(reply, request, ceilingProblem(outcome.requested, outcome.removed));
      case 'deleted':
        return reply.code(204).send();
    }
  };
}

export function readScopeRolesHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET scope roles route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readScopeRoles(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }

    reply.header('etag', outcome.etag);
    const wire: SetScopeRolesResponse = { items: [...outcome.roles] };
    return reply.code(200).send(wire);
  };
}

export function setScopeRolesHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT scope roles route received no :id');
    }
    const body = setScopeRolesRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setScopeRoles(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          roleIds: body.role_ids,
          callerCapabilities,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'unknown_role':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            outcome.roleIds.map((id) => ({ path: 'role_ids', message: `names no role ${id}` })),
            `unknown role id(s): ${outcome.roleIds.join(', ')}`,
          ),
        );
      case 'capability_ceiling':
        return sendProblem(reply, request, ceilingProblem(outcome.requested, outcome.removed));
      case 'precondition_required':
        return sendProblem(reply, request, ifMatchRequired('a scope\u2019s roles'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok': {
        reply.header('etag', outcome.etag);
        const wire: SetScopeRolesResponse = { items: [...outcome.roles] };
        return reply.code(200).send(wire);
      }
    }
  };
}

export function assignScopeToClientHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const clientId = request.params.clientId;
    if (id === undefined || clientId === undefined) {
      throw new Error('protocol-admin: PUT scope client route received no :id/:clientId');
    }
    const body = assignScopeToClientRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      assignScopeToClient(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          clientId,
          assignment: body.assignment,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'scope_not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
        );
      case 'client_not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no client ${clientId}`),
        );
      case 'target_ceiling':
        return serviceAccountCeilingProblem(reply, request, outcome.requested);
      case 'client_scope_limit':
        return sendProblem(
          reply,
          request,
          problem(409, 'about:blank', 'Conflict', outcome.message),
        );
      case 'ok':
        reply.header('etag', outcome.clientEtag);
        return reply.code(200).send(outcome.assignments);
    }
  };
}

export function unassignScopeFromClientHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const clientId = request.params.clientId;
    if (id === undefined || clientId === undefined) {
      throw new Error('protocol-admin: DELETE scope client route received no :id/:clientId');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      unassignScopeFromClient(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          clientId,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'scope_not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
        );
      case 'client_not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no client ${clientId}`),
        );
      case 'builtin_admin_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'target_ceiling':
        return serviceAccountCeilingProblem(reply, request, outcome.requested);
      case 'not_assigned':
        return sendProblem(
          reply,
          request,
          problem(
            404,
            'about:blank',
            'Not Found',
            `scope ${id} is not assigned to client ${clientId}`,
          ),
        );
      case 'removed':
        reply.header('etag', outcome.clientEtag);
        return reply.code(204).send();
    }
  };
}

export function listScopeClientsHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { tenant: tenantName, id } = request.params;
    if (tenantName === undefined || id === undefined) {
      throw new Error('protocol-admin: GET scope clients route received no :tenant/:id');
    }
    const query = listScopeClientsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listScopeClients(tx, {
        tenantId: targetTenantId,
        scopeId: id,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no scope ${id}`),
      );
    }
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
    }
    if (outcome.next === null) {
      return reply.code(200).send({ items: outcome.items });
    }
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/scopes/${id}/clients`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}
