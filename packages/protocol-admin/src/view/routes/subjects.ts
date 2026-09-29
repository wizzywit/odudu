import {
  amendProfileRequestSchema,
  amendSubjectRequestSchema,
  type AmendSubjectRequest,
  createSubjectRequestSchema,
  listSubjectsQuerySchema,
  setRequiredActionsRequestSchema,
  setRolesRequestSchema,
  setSubjectGroupsRequestSchema,
  type SetSubjectGroupsResponse,
  type SetRequiredActionsResponse,
  type SetRolesResponse,
  type Subject,
} from '@odudu/contracts/admin';
import { isCheckViolation, isUniqueViolation, type Database } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import { listEffectiveRoles } from '#/usecase/effective-roles';
import { amendProfile, PHONE_E164_MESSAGE, readProfile } from '#/usecase/profile';
import {
  amendSubject,
  createSubject,
  credentialWireShape,
  deleteCredential,
  deleteSubject,
  listCredentials,
  listSubjects,
  readRequiredActions,
  readSubject,
  readSubjectGroups,
  readSubjectRoles,
  setRequiredActions,
  setRoles,
  setSubjectGroups,
  subjectWireShape,
  type AmendSubjectOutcome,
  type Audit,
  type SubjectView,
  readUsernamePolicy,
} from '#/usecase/subjects';
import {
  cursorProblem,
  fieldProblem,
  ifMatchRequired,
  ifMatchStale,
  problem,
  queryProblem,
  sendProblem,
  lastAdministratorProblem,
} from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
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

// `users_username_unique` (0005_subjects.sql) and `users_email_unique`
// (0023_users_email_unique.sql) are what actually refuse a duplicate;
// `isUniqueViolation` (@odudu/db) recognizes the SQLSTATE, and the
// constraint name — still on the wrapped driver error at this depth — says
// which column it was, the same shape
// `classifyAccountCreationError` (packages/account/src/usecase/register.ts)
// reads for self-registration's own identical constraints.
function isUniqueViolationNaming(err: unknown, constraint: string): boolean {
  if (!isUniqueViolation(err)) return false;
  const cause = err instanceof Error ? err.cause : undefined;
  const message = cause instanceof Error ? cause.message : err instanceof Error ? err.message : '';
  return message.includes(constraint);
}

// Same shape, for `users_verified_phone_is_e164` (0024_verified_phone_is_
// e164.sql) — the one CHECK `amendProfile` cannot pre-validate with a
// TypeScript predicate, since E.164 is only required once
// `phone_number_verified` is true.
function isCheckViolationNaming(err: unknown, constraint: string): boolean {
  if (!isCheckViolation(err)) return false;
  const cause = err instanceof Error ? err.cause : undefined;
  const message = cause instanceof Error ? cause.message : err instanceof Error ? err.message : '';
  return message.includes(constraint);
}

export function listSubjectsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    // ADMIN_ROUTES' `querystringSchema` already validated each parameter's
    // shape; the one-search-field refinement has no JSON Schema form, so it
    // is only enforced here.
    const parsed = listSubjectsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendProblem(reply, request, queryProblem(parsed.error));
    }
    const query = parsed.data;
    const { cursor, limit: requestedLimit, ...filters } = query;
    const limit = coerceLimit(requestedLimit === undefined ? undefined : String(requestedLimit));
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: subjects route received no :tenant');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listSubjects(tx, {
        limit,
        cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
        filters,
        now: deps.now(),
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(reply, request, cursorProblem());
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

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readSubject(tx, id),
    );
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

export function readUsernamePolicyHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const policy = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readUsernamePolicy(tx, targetTenantId),
    );
    return reply.code(200).send({ username_editable: policy.usernameEditable });
  };
}

export function createSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = createSubjectRequestSchema.parse(request.body);

    let view: SubjectView;
    try {
      view = await adminTx(deps.database, request, targetTenantId, (tx) =>
        createSubject(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            username: body.username,
            email: body.email ?? null,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught — the same shape createClientHandler leaves
      // ClientIdConflictError in (#/view/routes/clients.ts).
      if (isUniqueViolationNaming(error, 'users_username_unique')) {
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
      if (isUniqueViolationNaming(error, 'users_email_unique')) {
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the email ${JSON.stringify(body.email)} is already in use`,
          ),
        );
      }
      if (error instanceof OduduError && error.code === 'invalid_email') {
        return sendProblem(
          reply,
          request,
          fieldProblem([{ path: 'email', message: error.message }], error.message),
        );
      }
      throw error;
    }

    const wire: Subject = subjectWireShape(view);
    reply.header('etag', etagOf(wire));
    return reply.code(201).send(wire);
  };
}

function uniqueConflictDetail(error: unknown, values: AmendSubjectRequest): string | null {
  if (isUniqueViolationNaming(error, 'users_username_unique')) {
    return `the username ${JSON.stringify(values.username)} is already in use`;
  }
  if (isUniqueViolationNaming(error, 'users_email_unique')) {
    return `the email ${JSON.stringify(values.email)} is already in use`;
  }
  return null;
}

function amendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<AmendSubjectOutcome, { kind: 'ok' }>,
): FastifyReply {
  switch (outcome.kind) {
    case 'last_administrator':
      return sendProblem(reply, request, lastAdministratorProblem(outcome.reason));
    case 'precondition_required':
      return sendProblem(reply, request, ifMatchRequired(`a subject's ${outcome.field}`));
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
    case 'target_ceiling':
      return targetCeilingProblem(reply, request, outcome.requested);
  }
}

export function targetCeilingProblem(
  reply: FastifyReply,
  request: AdminRequest,
  denied: readonly string[],
): FastifyReply {
  return sendProblem(
    reply,
    request,
    problem(
      403,
      'about:blank',
      'Forbidden',
      `the subject holds what the caller does not: ${denied.join(', ')}`,
    ),
  );
}

export function amendSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH subject route received no :id');
    }
    const values = amendSubjectRequestSchema.parse(request.body);

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    let outcome: AmendSubjectOutcome;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        amendSubject(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            subjectId: id,
            values,
            ifMatch: ifMatchHeader(request),
            callerCapabilities,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // Caught outside `adminTx`, so the transaction has rolled back and
      // nothing else the body asked for was applied.
      const conflict = uniqueConflictDetail(error, values);
      if (conflict === null) throw error;
      return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', conflict));
    }

    if (outcome.kind !== 'ok') {
      return amendmentProblem(reply, request, outcome);
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(subjectWireShape(outcome.subject));
  };
}

export function readProfileHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET profile route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readProfile(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.view);
  };
}

function profileAmendmentProblem(
  reply: FastifyReply,
  request: AdminRequest,
  outcome: Exclude<Awaited<ReturnType<typeof amendProfile>>, { kind: 'ok' }>,
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
    case 'target_ceiling':
      return targetCeilingProblem(reply, request, outcome.requested);
  }
}

export function amendProfileHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PATCH profile route received no :id');
    }
    const values = amendProfileRequestSchema.parse(request.body);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    let outcome: Awaited<ReturnType<typeof amendProfile>>;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        amendProfile(
          tx,
          { audit: deps.audit },
          {
            subjectId: id,
            values,
            ifMatch: ifMatchHeader(request),
            callerCapabilities,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // The transaction has already rolled back by the time this is
      // caught — the same shape createSubjectHandler leaves a unique
      // violation in above.
      if (isCheckViolationNaming(error, 'users_verified_phone_is_e164')) {
        return sendProblem(
          reply,
          request,
          fieldProblem([{ path: 'phone_number', message: PHONE_E164_MESSAGE }], PHONE_E164_MESSAGE),
        );
      }
      throw error;
    }

    if (outcome.kind !== 'ok') {
      return profileAmendmentProblem(reply, request, outcome);
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.view);
  };
}

export function deleteSubjectHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE subject route received no :id');
    }

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteSubject(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
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
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
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

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
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

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deleteCredential(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          credentialId,
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
      case 'refused':
        return sendProblem(reply, request, problem(409, 'about:blank', 'Conflict', outcome.reason));
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'deleted':
        return reply.code(204).send();
    }
  };
}

export function readRequiredActionsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET required-actions route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readRequiredActions(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    reply.header('etag', outcome.etag);
    const wire: SetRequiredActionsResponse = { actions: [...outcome.actions] };
    return reply.code(200).send(wire);
  };
}

export function readSubjectRolesHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET roles route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readSubjectRoles(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    reply.header('etag', outcome.etag);
    const wire: SetRolesResponse = { items: [...outcome.roles] };
    return reply.code(200).send(wire);
  };
}

export function listEffectiveRolesHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET effective-roles route received no :id');
    }
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listEffectiveRoles(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }
    return reply.code(200).send({ items: outcome.items });
  };
}

export function setRequiredActionsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT required-actions route received no :id');
    }
    const body = setRequiredActionsRequestSchema.parse(request.body);

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setRequiredActions(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          subjectId: id,
          actions: body.actions,
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
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'precondition_required':
        return sendProblem(reply, request, ifMatchRequired('a subject\u2019s required actions'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok': {
        reply.header('etag', outcome.etag);
        const wire: SetRequiredActionsResponse = { actions: [...outcome.actions] };
        return reply.code(200).send(wire);
      }
    }
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

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setRoles(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
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
      case 'last_administrator':
        return sendProblem(reply, request, lastAdministratorProblem(outcome.reason));
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
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
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
        return sendProblem(reply, request, ifMatchRequired('a subject\u2019s roles'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok': {
        reply.header('etag', outcome.etag);
        const wire: SetRolesResponse = { items: [...outcome.roles] };
        return reply.code(200).send(wire);
      }
    }
  };
}

export function readSubjectGroupsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET groups route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readSubjectGroups(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    reply.header('etag', outcome.etag);
    const wire: SetSubjectGroupsResponse = { items: [...outcome.groups] };
    return reply.code(200).send(wire);
  };
}

export function setSubjectGroupsHandler(deps: SubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: PUT groups route received no :id');
    }
    const body = setSubjectGroupsRequestSchema.parse(request.body);

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      setSubjectGroups(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          groupIds: body.group_ids,
          callerCapabilities,
          ifMatch: ifMatchHeader(request),
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
          problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
        );
      case 'unknown_group':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            outcome.groupIds.map((id) => ({ path: 'group_ids', message: `names no group ${id}` })),
            `unknown group id(s): ${outcome.groupIds.join(', ')}`,
          ),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
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
        return sendProblem(reply, request, ifMatchRequired('a subject\u2019s groups'));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      case 'ok': {
        reply.header('etag', outcome.etag);
        const wire: SetSubjectGroupsResponse = { items: [...outcome.groups] };
        return reply.code(200).send(wire);
      }
    }
  };
}
