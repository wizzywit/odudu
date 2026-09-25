import {
  amendScopeRequestSchema,
  assignScopeToClientRequestSchema,
  createScopeRequestSchema,
  listScopesQuerySchema,
  setScopeRolesRequestSchema,
  type ClientScope,
  type SetScopeRolesResponse,
} from '@odudu/contracts/admin';
import { isUniqueViolation, withTenant, type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  amendScope,
  assignScopeToClient,
  createScope,
  deleteScope,
  listScopes,
  readScope,
  setScopeRoles,
  type AmendScopeOutcome,
  type Audit,
} from '#/usecase/scopes';
import { problem, sendProblem } from '#/view/problem';
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
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: scopes route received no :tenant');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listScopes(tx, {
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) => readScope(tx, id));
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
      scope = await withTenant(deps.database, targetTenantId, (tx) =>
        createScope(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            description: body.description ?? null,
            includeInIdToken: body.include_in_id_token,
            includeInAccessToken: body.include_in_access_token,
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
        problem(400, 'about:blank', 'Bad Request', `${outcome.field}: ${outcome.reason}`),
      );
    case 'invalid_value':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', `${outcome.field}: ${outcome.description}`),
      );
    case 'precondition_failed':
      return sendProblem(
        reply,
        request,
        problem(412, 'about:blank', 'Precondition Failed', 'If-Match no longer matches'),
      );
  }
}

export function amendScopeHandler(deps: ScopesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH scope route received no :id');
    }
    const values = amendScopeRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteScope(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'deleted':
        return reply.code(204).send();
    }
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      setScopeRoles(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          roleIds: body.role_ids,
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
      case 'unknown_role':
        return sendProblem(
          reply,
          request,
          problem(
            400,
            'about:blank',
            'Bad Request',
            `unknown role id(s): ${outcome.roleIds.join(', ')}`,
          ),
        );
      case 'capability_ceiling':
        return sendProblem(
          reply,
          request,
          problem(
            403,
            'about:blank',
            'Forbidden',
            `the caller does not hold: ${outcome.requested.join(', ')}`,
          ),
        );
      case 'ok': {
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      assignScopeToClient(
        tx,
        { audit: deps.audit },
        {
          scopeId: id,
          clientId,
          assignment: body.assignment,
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
      case 'ok':
        return reply.code(200).send(outcome.assignments);
    }
  };
}
