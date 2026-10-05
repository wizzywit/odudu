import {
  addRoleCompositeRequestSchema,
  amendRoleRequestSchema,
  createRoleRequestSchema,
  listRolesQuerySchema,
  setRoleDefaultRequestSchema,
} from '@odudu/contracts/admin';
import { isUniqueViolation, type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import { roleWireOf, withRoleReach } from '#/usecase/admin-reach';
import {
  addRoleComposite,
  amendRole,
  createRole,
  deleteRole,
  listRoleComposites,
  listRoles,
  readRole,
  removeRoleComposite,
  setRoleDefault,
  type AddRoleCompositeOutcome,
  type AmendRoleOutcome,
  type Audit,
  type CreateRoleOutcome,
} from '#/usecase/roles';
import {
  ceilingProblem,
  cursorProblem,
  fieldProblem,
  ifMatchStale,
  problem,
  sendProblem,
  type Problem,
  lastAdministratorProblem,
} from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
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

function defaultRoleCapabilityProblem(capabilities: readonly string[]): Problem {
  return problem(
    403,
    'about:blank',
    'Forbidden',
    `a role handed to every new subject may reach no admin capability, and this one would reach: ${capabilities.join(', ')}`,
  );
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function listRolesHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listRolesQuerySchema.parse(request.query);
    const { cursor, limit: requestedLimit, ...filters } = query;
    const limit = coerceLimit(requestedLimit === undefined ? undefined : String(requestedLimit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: roles route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      const listed = await listRoles(tx, {
        limit,
        cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
        filters,
      });
      return listed.kind === 'ok'
        ? { ...listed, items: await withRoleReach(tx, listed.items) }
        : listed;
    });
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
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

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      const read = await readRole(tx, id);
      return read.kind === 'ok' ? { ...read, wire: await roleWireOf(tx, read.role) } : read;
    });
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found', `no role ${id}`));
    }

    reply.header('etag', etagOf(outcome.role));
    return reply.code(200).send(outcome.wire);
  };
}

export function createRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createRoleRequestSchema.parse(request.body);

    let outcome:
      | Exclude<CreateRoleOutcome, { kind: 'ok' }>
      | (Extract<CreateRoleOutcome, { kind: 'ok' }> & {
          wire: Awaited<ReturnType<typeof roleWireOf>>;
        });
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
        const created = await createRole(
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
        );
        return created.kind === 'ok'
          ? { ...created, wire: await roleWireOf(tx, created.role) }
          : created;
      });
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

    if (outcome.kind === 'unknown_client') {
      return sendProblem(
        reply,
        request,
        fieldProblem(
          [{ path: 'client_id', message: 'names no client' }],
          'client_id names no client',
        ),
      );
    }
    if (outcome.kind === 'default_on_admin_client') {
      return sendProblem(
        reply,
        request,
        problem(
          403,
          'about:blank',
          'Forbidden',
          `a role of ${outcome.adminClient}, this tenant's built-in admin client, is an admin capability and cannot be handed to every new subject`,
        ),
      );
    }
    reply.header('etag', etagOf(outcome.role));
    return reply.code(201).send(outcome.wire);
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
  }
}

export function amendRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH role route received no :id');
    }
    const values = amendRoleRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      const amended = await amendRole(
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
      );
      return amended.kind === 'ok'
        ? { ...amended, wire: await roleWireOf(tx, amended.role) }
        : amended;
    });

    if (outcome.kind !== 'ok') {
      return amendmentProblem(reply, request, outcome);
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.wire);
  };
}

export function deleteRoleHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE role route received no :id');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteRole(
        tx,
        { audit: deps.audit },
        {
          roleId: id,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'last_administrator':
        return sendProblem(reply, request, lastAdministratorProblem(outcome.reason));
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'builtin_admin_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'capability_ceiling':
        return sendProblem(reply, request, ceilingProblem(outcome.requested, outcome.removed));
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
        fieldProblem(
          [{ path: 'child_role_id', message: 'names no role' }],
          'child_role_id names no role',
        ),
      );
    case 'builtin_admin_guarded':
      return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
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
    case 'default_role_capability':
      return sendProblem(reply, request, defaultRoleCapabilityProblem(outcome.capabilities));
    case 'cycle':
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'would create a role composite cycle'),
      );
    case 'precondition_failed':
      return sendProblem(reply, request, ifMatchStale());
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

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      addRoleComposite(
        tx,
        { audit: deps.audit },
        {
          parentRoleId: id,
          childRoleId: body.child_role_id,
          ifMatch: ifMatchHeader(request),
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
    reply.header('etag', outcome.etag);
    return reply.code(204).send();
  };
}

export function listRoleCompositesHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET composites route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      const listed = await listRoleComposites(tx, id);
      return listed.kind === 'ok'
        ? { ...listed, items: await withRoleReach(tx, listed.items) }
        : listed;
    });
    if (outcome.kind === 'not_found') {
      return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found', `no role ${id}`));
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send({ items: outcome.items });
  };
}

export function removeRoleCompositeHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const { id, childId } = request.params;
    if (id === undefined || childId === undefined) {
      throw new Error('protocol-admin: DELETE composite route received no :id or :childId');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      removeRoleComposite(
        tx,
        { audit: deps.audit },
        {
          parentRoleId: id,
          childRoleId: childId,
          ifMatch: ifMatchHeader(request),
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'last_administrator':
        return sendProblem(reply, request, lastAdministratorProblem(outcome.reason));
      case 'not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no composite ${childId} under role ${id}`),
        );
      case 'builtin_admin_guarded':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'capability_ceiling':
        return sendProblem(reply, request, ceilingProblem(outcome.requested, outcome.removed));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'removed':
        reply.header('etag', outcome.etag);
        return reply.code(204).send();
    }
  };
}

export function setRoleDefaultHandler(deps: RolesRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT default route received no :id');
    }
    const body = setRoleDefaultRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, async (tx) => {
      const set = await setRoleDefault(
        tx,
        { audit: deps.audit },
        {
          roleId: id,
          value: body.default,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      );
      return set.kind === 'ok' ? { ...set, wire: await roleWireOf(tx, set.role) } : set;
    });

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no role ${id}`),
        );
      case 'default_role_capability':
        return sendProblem(reply, request, defaultRoleCapabilityProblem(outcome.capabilities));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.wire);
    }
  };
}
