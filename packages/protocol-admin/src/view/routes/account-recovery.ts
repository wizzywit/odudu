import { type Database } from '@odudu/db';
import { clearLockout, issuePassword, type Audit } from '#/usecase/account-recovery';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface AccountRecoveryRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
}

export function issuePasswordHandler(deps: AccountRecoveryRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST password route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      issuePassword(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          subjectId: id,
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
          problem(404, 'about:blank', 'Not Found', `no user subject ${id}`),
        );
      case 'issued':
        return reply.code(201).header('cache-control', 'no-store').send({
          password: outcome.password,
        });
    }
  };
}

export function clearLockoutHandler(deps: AccountRecoveryRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE lockout route received no :id');
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      clearLockout(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          subjectId: id,
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
      case 'cleared':
        return reply.code(204).send();
    }
  };
}
