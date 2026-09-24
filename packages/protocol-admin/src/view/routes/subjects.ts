import {
  createSubjectRequestSchema,
  listSubjectsQuerySchema,
  type Subject,
} from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { coerceLimit } from '#/service/cursor';
import { etagOf } from '#/service/etag';
import {
  createSubject,
  listSubjects,
  readSubject,
  subjectWireShape,
  type Audit,
  type SubjectView,
} from '#/usecase/subjects';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface SubjectsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
}

function toWireSubject(view: SubjectView): Subject {
  return subjectWireShape(view);
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

    const items = outcome.items.map(toWireSubject);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = `/admin/tenants/${tenantName}/subjects?limit=${String(limit)}&cursor=${encodeURIComponent(outcome.next)}`;
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

    const wire = toWireSubject(outcome.subject);
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

    const wire: Subject = toWireSubject(view);
    return reply.code(201).send(wire);
  };
}
