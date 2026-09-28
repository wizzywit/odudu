import { exportTenantQuerySchema, TENANT_DOCUMENT_MEDIA_TYPE } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type TenantCapability } from '@odudu/domain-tenant';
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

const CLIENTS_CAPABILITY: TenantCapability = 'manage-clients';
const SUBJECTS_CAPABILITY: TenantCapability = 'view-users';

export function exportTenantHandler(deps: TenantExportRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    // ADMIN_ROUTES' `querystringSchema` already refused anything else;
    // parsing again only narrows the type.
    const query = exportTenantQuerySchema.parse(request.query);
    const includeSubjects = query.include === 'subjects';

    // The route's own capability is checked by the router; clients, and
    // subjects when asked for, are further doors on the same route, each held
    // to the capability that reads it anywhere else and refused the way the
    // router refuses one.
    const held = await deps.callerCapabilities(principal.issuerTenantId, principal.subjectId);
    const required = includeSubjects
      ? [CLIENTS_CAPABILITY, SUBJECTS_CAPABILITY]
      : [CLIENTS_CAPABILITY];
    const missing = required.find((capability) => !held.has(capability));
    if (missing !== undefined) {
      await recordRefusal(deps.database, request, targetTenantId, (tx) =>
        recordCapabilityRefused(tx, principal, missing),
      );
      return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
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
