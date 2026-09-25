import {
  amendGroupRequestSchema,
  createGroupRequestSchema,
  listGroupsQuerySchema,
  setGroupRolesRequestSchema,
  type SetGroupRolesResponse,
} from '@odudu/contracts/admin';
import { isUniqueViolation, type Database } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  amendGroup,
  createGroup,
  deleteGroup,
  listGroups,
  readGroup,
  readGroupRoles,
  setGroupRoles,
  type AmendGroupOutcome,
  type Audit,
  type CreateGroupOutcome,
} from '#/usecase/groups';
import { ifMatchRequired, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface GroupsRouteDeps {
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

export function listGroupsHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listGroupsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: groups route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listGroups(tx, {
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
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/groups`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function readGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET group route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readGroup(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no group ${id}`),
      );
    }

    reply.header('etag', etagOf(outcome.group));
    return reply.code(200).send(outcome.group);
  };
}

function isParentNotFoundError(err: unknown): boolean {
  return err instanceof OduduError && err.code === 'group_not_found';
}

export function createGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createGroupRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    let outcome: CreateGroupOutcome;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        createGroup(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            parentId: body.parent_id ?? null,
            callerCapabilities,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      if (isParentNotFoundError(error)) {
        return sendProblem(
          reply,
          request,
          problem(400, 'about:blank', 'Bad Request', 'parent_id names no group'),
        );
      }
      // `groups_path_unique` (0018_groups.sql): a sibling by the same name
      // under the same parent. The transaction has already rolled back by
      // the time this is caught, the same shape `createRole` leaves it in
      // (#/view/routes/roles.ts).
      if (isUniqueViolation(error)) {
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `a group named ${JSON.stringify(body.name)} already exists there`,
          ),
        );
      }
      throw error;
    }

    if (outcome.kind === 'capability_ceiling') {
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
    }
    return reply.code(201).send(outcome.group);
  };
}

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendGroupOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    case 'unknown_parent':
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'parent_id names no group'),
      );
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
    case 'cycle':
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'would create a group reparent cycle'),
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
  }
}

export function amendGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH group route received no :id');
    }
    const values = amendGroupRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      amendGroup(
        tx,
        { audit: deps.audit },
        {
          groupId: id,
          values,
          ifMatch: ifMatchHeader(request),
          callerCapabilities,
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
    return reply.code(200).send(outcome.group);
  };
}

export function deleteGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE group route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteGroup(
        tx,
        { audit: deps.audit },
        {
          groupId: id,
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

export function readGroupRolesHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET group roles route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readGroupRoles(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    }

    reply.header('etag', outcome.etag);
    const wire: SetGroupRolesResponse = { items: [...outcome.roles] };
    return reply.code(200).send(wire);
  };
}

export function setGroupRolesHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT group roles route received no :id');
    }
    const body = setGroupRolesRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setGroupRoles(
        tx,
        { audit: deps.audit },
        {
          groupId: id,
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
      case 'precondition_required':
        return sendProblem(reply, request, ifMatchRequired('a group\u2019s roles'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok': {
        reply.header('etag', outcome.etag);
        const wire: SetGroupRolesResponse = { items: [...outcome.roles] };
        return reply.code(200).send(wire);
      }
    }
  };
}
