import { type Consent } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type SubjectConsent } from '@odudu/domain-tenant';
import { listConsents, revokeConsent, type Audit } from '#/usecase/consents';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface ConsentsRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
}

function consentWireShape(view: SubjectConsent): Consent {
  return {
    client_id: view.clientId,
    client_key: view.clientKey,
    scope_names: [...view.scopeNames],
    granted_at: view.grantedAt.toISOString(),
  };
}

export function listConsentsHandler(deps: ConsentsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: GET consents route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listConsents(tx, { subjectId: id }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no subject ${id}`),
      );
    }

    return reply.code(200).send({ items: outcome.items.map(consentWireShape) });
  };
}

export function deleteConsentHandler(deps: ConsentsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    const clientId = request.params.clientId;
    if (id === undefined || clientId === undefined) {
      throw new Error('protocol-admin: DELETE consent route received no :id/:clientId');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeConsent(
        tx,
        { audit: deps.audit },
        {
          subjectId: id,
          clientId,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    switch (outcome.kind) {
      case 'not_found':
        return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
      case 'revoked':
        return reply.code(204).send();
    }
  };
}
