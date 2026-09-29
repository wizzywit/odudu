import { type Database, type TenantScopedDatabase } from '@odudu/db';
import { clearLockout, issuePassword, type Audit } from '#/usecase/account-recovery';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingProblem } from '#/view/routes/subjects';

export interface AccountRecoveryRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  /** See `SubjectsRouteDeps.callerCapabilities` — the same resolution. */
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  /** See `IssuePasswordDeps.retireResetLinks`. */
  readonly retireResetLinks: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
}

export function issuePasswordHandler(deps: AccountRecoveryRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: POST password route received no :id');
    }

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      issuePassword(
        tx,
        { audit: deps.audit, retireResetLinks: deps.retireResetLinks },
        {
          tenantId: targetTenantId,
          subjectId: id,
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
          problem(404, 'about:blank', 'Not Found', `no user subject ${id}`),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'issued':
        return reply.code(201).send({ password: outcome.password });
    }
  };
}

export function clearLockoutHandler(deps: AccountRecoveryRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) {
      throw new Error('protocol-admin: DELETE lockout route received no :id');
    }

    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      clearLockout(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          subjectId: id,
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
          problem(404, 'about:blank', 'Not Found', `no user subject ${id}`),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'cleared':
        return reply.code(204).send();
    }
  };
}
