import { type Session } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { endSession, listSessions, type Audit, type SessionView } from '#/usecase/sessions';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface SessionsRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly kek: Uint8Array;
  readonly now: () => Date;
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

    const items = await withTenant(deps.database, targetTenantId, (tx) =>
      listSessions(tx, { tenantId: targetTenantId, subjectId: id, now: deps.now() }),
    );
    return reply.code(200).send({ items: items.map(sessionWireShape) });
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
