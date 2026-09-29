import { cursorQuerySchema, type Grant } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  listSubjectGrants,
  revokeClientGrants,
  revokeSubjectGrants,
  type Audit,
  type GrantView,
} from '#/usecase/grants';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingProblem } from '#/view/routes/subjects';

export interface GrantsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
}

function grantWireShape(view: GrantView): Grant {
  return {
    id: view.id,
    client_id: view.clientDbId,
    client_key: view.clientKey,
    scope: view.scope,
    created_at: view.createdAt.toISOString(),
    session_id: view.sessionId,
    offline: view.sessionId === null,
    refresh_expires_at: view.refreshExpiresAt?.toISOString() ?? null,
  };
}

export function listSubjectGrantsHandler(deps: GrantsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { id, tenant } = request.params;
    if (id === undefined || tenant === undefined) {
      throw new Error('protocol-admin: GET grants route received no :tenant/:id');
    }
    const query = cursorQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listSubjectGrants(tx, {
        tenantId: targetTenantId,
        subjectId: id,
        now: deps.now(),
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    const items = outcome.items.map(grantWireShape);
    if (outcome.next === null) return reply.code(200).send({ items });
    const nextUrl = nextPageUrl(`/admin/tenants/${tenant}/subjects/${id}/grants`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function revokeSubjectGrantsHandler(deps: GrantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const { id, clientId } = request.params;
    if (id === undefined || clientId === undefined) {
      throw new Error('protocol-admin: DELETE grants route received no :id/:clientId');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeSubjectGrants(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          clientDbId: clientId,
          now: deps.now(),
          callerCapabilities,
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
      case 'revoked':
        return reply.code(200).send({ revoked: outcome.revoked });
    }
  };
}

export function revokeClientGrantsHandler(deps: GrantsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined)
      throw new Error('protocol-admin: DELETE client grants route received no :id');
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeClientGrants(
        tx,
        { audit: deps.audit },
        {
          clientDbId: id,
          now: deps.now(),
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no client ${id}`),
      );
    }
    return reply
      .code(200)
      .send({ revoked: outcome.revoked, beyond_ceiling: outcome.beyondCeiling });
  };
}
