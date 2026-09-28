import { exportTenantQuerySchema, TENANT_DOCUMENT_MEDIA_TYPE } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { recordCapabilityRefused } from '#/usecase/access-audit';
import { exportTenant, tooManySubjectsDetail, type Audit } from '#/usecase/tenant-export';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { recordRefusal, type AdminRouteHandler } from '#/view/routes/router';

export interface TenantExportRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>>;
}

const SUBJECTS_CAPABILITY = 'view-users';

export function exportTenantHandler(deps: TenantExportRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    // ADMIN_ROUTES' `querystringSchema` already refused anything else;
    // parsing again only narrows the type.
    const query = exportTenantQuerySchema.parse(request.query);
    const includeSubjects = query.include === 'subjects';

    // The route's own capability is checked by the router; subjects are a
    // second door on the same route, held to the capability that reads them
    // anywhere else, and refused the way the router refuses one.
    if (includeSubjects) {
      const held = await deps.callerCapabilities(principal.issuerTenantId, principal.subjectId);
      if (!held.has(SUBJECTS_CAPABILITY)) {
        await recordRefusal(deps.database, request, targetTenantId, (tx) =>
          recordCapabilityRefused(tx, principal, SUBJECTS_CAPABILITY),
        );
        return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
      }
    }

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      exportTenant(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          includeSubjects,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind === 'too_many_subjects') {
      return sendProblem(
        reply,
        request,
        problem(
          413,
          'about:blank#export-too-large',
          'Content Too Large',
          tooManySubjectsDetail(outcome.cap),
        ),
      );
    }

    return reply
      .code(200)
      .header('content-type', TENANT_DOCUMENT_MEDIA_TYPE)
      .send(outcome.document);
  };
}
