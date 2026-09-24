import { cursorQuerySchema, type Session } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { tenantIssuerFor, type TenantLookup } from '@odudu/protocol-oidc';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { lifespansOf } from '#/usecase/authenticate-admin';
import { endSession, listSessions, type Audit, type SessionView } from '#/usecase/sessions';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface SessionsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  readonly kek: Uint8Array;
  readonly now: () => Date;
  /** Resolves the four `SessionLifespans` columns liveness needs — the same lookup `router.ts` already trusted to resolve this tenant. */
  readonly findTenant: (name: string) => Promise<TenantLookup | null>;
}

function sessionWireShape(view: SessionView): Session {
  return {
    id: view.id,
    created_at: view.createdAt.toISOString(),
    last_active_at: view.lastActiveAt.toISOString(),
    remembered: view.remembered,
    client_ids: [...view.clientIds],
  };
}

export function listSessionsHandler(deps: SessionsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET sessions route received no :id');
    }
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: GET sessions route received no :tenant');
    }
    // Same narrowing as listSubjectsHandler (#/view/routes/subjects.ts):
    // ADMIN_ROUTES' `querystringSchema` already validated shape.
    const query = cursorQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));

    const tenant = await deps.findTenant(tenantName);
    if (tenant === null) {
      throw new Error(`protocol-admin: sessions route resolved a tenant router.ts already found`);
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      listSessions(tx, {
        tenantId: targetTenantId,
        subjectId: id,
        lifespans: lifespansOf(tenant),
        now: deps.now(),
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'invalid_cursor') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'cursor is invalid or expired'),
      );
    }

    const items = outcome.items.map(sessionWireShape);
    if (outcome.next === null) {
      return reply.code(200).send({ items });
    }

    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/subjects/${id}/sessions`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function deleteSessionHandler(deps: SessionsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const sessionId = request.params.sid;
    if (id === undefined || sessionId === undefined) {
      throw new Error('protocol-admin: DELETE session route received no :id/:sid');
    }
    const tenantName = request.params.tenant;
    if (tenantName === undefined) {
      throw new Error('protocol-admin: DELETE session route received no :tenant');
    }

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      endSession(
        tx,
        { audit: deps.audit, kek: deps.kek },
        {
          tenantId: targetTenantId,
          subjectId: id,
          sessionId,
          actorSubjectId: principal.subjectId,
          issuer: tenantIssuerFor(request, tenantName),
          now: deps.now(),
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'ended':
        return reply.code(204).send();
    }
  };
}
