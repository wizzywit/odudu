import { bulkSubjectsRequestSchema, type BulkSubjectResult } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { tenantIssuerFor, type TenantLookup } from '@odudu/protocol-oidc';
import { recordCapabilityRefused } from '#/usecase/access-audit';
import { lifespansOf } from '#/usecase/authenticate-admin';
import { bulkSubjects, type BulkSubjectOutcome } from '#/usecase/bulk-subjects';
import { clearLockouts, type LockoutsAuditEvent } from '#/usecase/lockouts';
import { type Audit as SessionAudit } from '#/usecase/sessions';
import { type Audit as SubjectAudit } from '#/usecase/subjects';
import { lastAdministratorProblem, problem, sendProblem, type Problem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { recordRefusal, type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingDetail } from '#/view/routes/subjects';

export interface BulkSubjectsRouteDeps {
  readonly database: Database;
  readonly subjectAudit: SubjectAudit;
  readonly sessionAudit: SessionAudit;
  readonly lockoutsAudit: (
    tx: Parameters<SubjectAudit>[0],
    event: LockoutsAuditEvent,
  ) => Promise<void>;
  readonly kek: Uint8Array;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
  readonly findTenant: (name: string) => Promise<TenantLookup | null>;
}

function refusal(id: string, refused: Problem): BulkSubjectResult {
  return {
    id,
    status: refused.status,
    type: refused.type,
    ...(refused.detail === undefined ? {} : { detail: refused.detail }),
  };
}

function resultOf(outcome: BulkSubjectOutcome): BulkSubjectResult {
  switch (outcome.kind) {
    case 'done':
      return { id: outcome.id, status: 204 };
    case 'ended':
      return { id: outcome.id, status: 200, ended: outcome.ended };
    case 'not_found':
      return refusal(
        outcome.id,
        problem(404, 'about:blank', 'Not Found', `no subject ${outcome.id}`),
      );
    case 'target_ceiling':
      return refusal(
        outcome.id,
        problem(403, 'about:blank', 'Forbidden', targetCeilingDetail(outcome.requested)),
      );
    case 'last_administrator':
      return refusal(outcome.id, lastAdministratorProblem(outcome.reason));
  }
}

// Ending sessions is `manage-sessions`' door wherever else it is offered, so
// this route, gated on `manage-users`, holds that action to it as well.
export function bulkSubjectsHandler(deps: BulkSubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = bulkSubjectsRequestSchema.parse(request.body);
    const tenantName = request.params.tenant;
    if (tenantName === undefined) throw new Error('protocol-admin: bulk route received no :tenant');
    const tenant = await deps.findTenant(tenantName);
    if (tenant === null) {
      throw new Error('protocol-admin: bulk route resolved a tenant router.ts already found');
    }
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    if (body.action === 'end-sessions' && !callerCapabilities.has('manage-sessions')) {
      await recordRefusal(deps.database, request, targetTenantId, (tx) =>
        recordCapabilityRefused(tx, principal, 'manage-sessions'),
      );
      return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
    }

    const outcomes = await bulkSubjects(
      {
        inTransaction: (fn) => adminTx(deps.database, request, targetTenantId, fn),
        subjectAudit: deps.subjectAudit,
        sessionAudit: deps.sessionAudit,
        kek: deps.kek,
      },
      {
        tenantId: targetTenantId,
        action: body.action,
        ids: body.ids,
        callerCapabilities,
        lifespans: lifespansOf(tenant),
        issuer: tenantIssuerFor(request, tenantName),
        now: deps.now(),
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      },
    );
    return reply.code(200).send({ items: outcomes.map(resultOf) });
  };
}

export function clearLockoutsHandler(deps: BulkSubjectsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      clearLockouts(
        tx,
        { audit: deps.lockoutsAudit },
        {
          tenantId: targetTenantId,
          callerCapabilities,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );
    return reply.code(200).send({
      cleared: outcome.cleared,
      beyond_ceiling: outcome.beyondCeiling,
      remaining: outcome.remaining,
    });
  };
}
