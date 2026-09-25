import {
  addRoleCompositeRequestSchema,
  amendRoleRequestSchema,
  createRoleRequestSchema,
  listRolesQuerySchema,
  type Role,
} from '@odudu/contracts/admin';
import { isUniqueViolation, withTenant, type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  addRoleComposite,
  amendRole,
  createRole,
  deleteRole,
  listRoles,
  readRole,
  type AddRoleCompositeOutcome,
  type AmendRoleOutcome,
  type Audit,
} from '#/usecase/roles';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface RolesRouteDeps {
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

export function listRolesHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listRolesQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: roles route received no :tenant');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listRoles(tx, {
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
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/roles`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function readRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET role route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) => readRole(tx, id));
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found', `no role ${id}`));
    }

    reply.header('etag', etagOf(outcome.role));
    return reply.code(200).send(outcome.role);
  };
}

export function createRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createRoleRequestSchema.parse(request.body);

    let role: Role;
    try {
      role = await withTenant(deps.database, targetTenantId, (tx) =>
        createRole(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            description: body.description ?? null,
            clientId: body.client_id ?? null,
            defaultForNewSubjects: body.default_for_new_subjects ?? false,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // `roles_tenant_name` (0017_roles.sql, renamed to its current name by
      // migration 0058) and `roles_client_name` are what actually refuse a
      // duplicate; the transaction has already rolled back by the time
      // this is caught, the same shape `createScope` leaves it in
      // (#/view/routes/scopes.ts).
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

    return reply.code(201).send(role);
  };
}

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendRoleOutcome, { kind: 'ok' }>,
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

export function amendRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH role route received no :id');
    }
    const values = amendRoleRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      amendRole(
        tx,
        { audit: deps.audit },
        {
          roleId: id,
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
    return reply.code(200).send(outcome.role);
  };
}

export function deleteRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE role route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteRole(
        tx,
        { audit: deps.audit },
        {
          roleId: id,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
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

function compositeProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AddRoleCompositeOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found', 'no such role'));
    case 'unknown_child_role':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'child_role_id names no role'),
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
    case 'cycle':
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'would create a role composite cycle'),
      );
  }
}

export function addRoleCompositeHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST composite route received no :id');
    }
    const body = addRoleCompositeRequestSchema.parse(request.body);

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      addRoleComposite(
        tx,
        { audit: deps.audit },
        {
          parentRoleId: id,
          childRoleId: body.child_role_id,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return compositeProblem(reply, request, outcome);
    }
    return reply.code(204).send();
  };
}
