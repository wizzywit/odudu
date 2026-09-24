import {
  amendGroupRequestSchema,
  createGroupRequestSchema,
  listGroupsQuerySchema,
  setGroupRolesRequestSchema,
  type Group,
  type SetGroupRolesResponse,
} from '@odudu/contracts/admin';
import { isUniqueViolation, withTenant, type Database } from '@odudu/db';
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
  setGroupRoles,
  type AmendGroupOutcome,
  type Audit,
} from '#/usecase/groups';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface GroupsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
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

    const outcome = await withTenant(deps.database, targetTenantId, (tx) => readGroup(tx, id));
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

    let group: Group;
    try {
      group = await withTenant(deps.database, targetTenantId, (tx) =>
        createGroup(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            parentId: body.parent_id ?? null,
            actorSubjectId: principal.subjectId,
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

    return reply.code(201).send(group);
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
  }
}

export function amendGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH group route received no :id');
    }
    const values = amendGroupRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      amendGroup(
        tx,
        { audit: deps.audit },
        {
          groupId: id,
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
    return reply.code(200).send(outcome.group);
  };
}

export function deleteGroupHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE group route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteGroup(tx, { audit: deps.audit }, { groupId: id, actorSubjectId: principal.subjectId }),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'deleted':
        return reply.code(204).send();
    }
  };
}

export function setGroupRolesHandler(deps: GroupsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT group roles route received no :id');
    }
    const body = setGroupRolesRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      setGroupRoles(
        tx,
        { audit: deps.audit },
        { groupId: id, roleIds: body.role_ids, actorSubjectId: principal.subjectId },
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
      case 'ok': {
        const wire: SetGroupRolesResponse = { items: [...outcome.roles] };
        return reply.code(200).send(wire);
      }
    }
  };
}
