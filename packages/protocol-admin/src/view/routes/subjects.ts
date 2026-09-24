import {
  amendSubjectRequestSchema,
  createSubjectRequestSchema,
  listSubjectsQuerySchema,
  setRequiredActionsRequestSchema,
  setRolesRequestSchema,
  type SetRequiredActionsResponse,
  type SetRolesResponse,
  type Subject,
} from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  amendSubject,
  createSubject,
  credentialWireShape,
  deleteCredential,
  deleteSubject,
  listCredentials,
  listSubjects,
  readSubject,
  setRequiredActions,
  setRoles,
  subjectWireShape,
  type AmendSubjectOutcome,
  type Audit,
  type SubjectView,
} from '#/usecase/subjects';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface SubjectsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  readonly now: () => Date;
  /**
   * The caller's own admin-client capability names, resolved against its
   * own issuer tenant and expanded through `role_composites` — what
   * `setRoles`'s capability ceiling compares a requested role set against.
   * Wired at the composition root (`#/index.ts`) the same way
   * `AuthorizeAdminDeps.effectiveRoles` is.
   */
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

// `users_username_unique` (0005_subjects.sql) is what actually refuses a
// duplicate; this only recognizes the refusal after the fact — the same
// shape `classifyAccountCreationError` (packages/account/src/usecase/register.ts)
// reads for self-registration's own identical constraint.
function isUsernameTakenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = err.cause;
  return cause instanceof Error && cause.message.includes('users_username_unique');
}

export function listSubjectsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    // Same narrowing as listClientsHandler (#/view/routes/clients.ts):
    // ADMIN_ROUTES' `querystringSchema` already validated shape.
    const query = listSubjectsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: subjects route received no :tenant');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listSubjects(tx, {
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
        search: query.search,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
    }

    const items = outcome.items.map(subjectWireShape);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/subjects`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function readSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET subject route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) => readSubject(tx, id));
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    const wire = subjectWireShape(outcome.subject);
    reply.header('etag', etagOf(wire));
    return reply.code(200).send(wire);
  };
}

export function createSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createSubjectRequestSchema.parse(request.body);

    let view: SubjectView;
    try {
      view = await withTenant(deps.database, targetTenantId, (tx) =>
        createSubject(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            username: body.username,
            email: body.email ?? null,
            actorSubjectId: principal.subjectId,
          },
        ),
      );
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught — the same shape createClientHandler leaves
      // ClientIdConflictError in (#/view/routes/clients.ts).
      if (isUsernameTakenError(error)) {
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the username ${JSON.stringify(body.username)} is already in use`,
          ),
        );
      }
      throw error;
    }

    const wire: Subject = subjectWireShape(view);
    return reply.code(201).send(wire);
  };
}

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendSubjectOutcome, { kind: 'ok' }>,
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

export function amendSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH subject route received no :id');
    }
    const values = amendSubjectRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      amendSubject(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
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
    return reply.code(200).send(subjectWireShape(outcome.subject));
  };
}

export function deleteSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE subject route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteSubject(
        tx,
        { audit: deps.audit },
        { subjectId: id, actorSubjectId: principal.subjectId },
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

export function listCredentialsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET credentials route received no :id');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listCredentials(tx, { tenantId: targetTenantId, subjectId: id, now: deps.now() }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    return reply.code(200).send({ items: outcome.items.map(credentialWireShape) });
  };
}

export function deleteCredentialHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const credentialId = request.params.credentialId;
    if (id === undefined || credentialId === undefined) {
      throw new Error('protocol-admin: DELETE credential route received no :id/:credentialId');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      deleteCredential(
        tx,
        { audit: deps.audit },
        { subjectId: id, credentialId, actorSubjectId: principal.subjectId },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'refused':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'deleted':
        return reply.code(204).send();
    }
  };
}

export function setRequiredActionsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT required-actions route received no :id');
    }
    const body = setRequiredActionsRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      setRequiredActions(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          subjectId: id,
          actions: body.actions,
          actorSubjectId: principal.subjectId,
        },
      ),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    const wire: SetRequiredActionsResponse = { actions: [...outcome.actions] };
    return reply.code(200).send(wire);
  };
}

export function setRolesHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT roles route received no :id');
    }
    const body = setRolesRequestSchema.parse(request.body);

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      setRoles(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          roleIds: body.role_ids,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
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
        const wire: SetRolesResponse = { items: [...outcome.roles] };
        return reply.code(200).send(wire);
      }
    }
  };
}
