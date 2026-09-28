import { importTenantRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { importTenant, type ImportTenantDeps } from '#/usecase/tenant-import';
import { fieldProblem, problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface TenantImportRouteDeps extends Omit<ImportTenantDeps, 'database'> {
  readonly database: Database;
  callerCapabilities(issuerTenantId: string, subjectId: string): Promise<ReadonlySet<string>>;
}

export function importTenantHandler(deps: TenantImportRouteDeps): AdminRouteHandler {
  return async (request, reply, principal) => {
    // ADMIN_ROUTES' `bodySchema` already validated the envelope; the
    // document inside it is the import's own to validate.
    const body = importTenantRequestSchema.parse(request.body);

    const outcome = await importTenant(
      deps,
      {
        name: body.name,
        displayName: body.display_name,
        document: body.document,
        callerCapabilities: await deps.callerCapabilities(
          principal.issuerTenantId,
          principal.subjectId,
        ),
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      },
      requestContextFrom(request),
    );

    switch (outcome.kind) {
      case 'invalid':
        return sendProblem(
          reply,
          request,
          fieldProblem(
            outcome.errors,
            `the import was refused for ${String(outcome.errors.length)} problem(s), listed under errors`,
          ),
        );
      case 'name_taken':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank',
            'Conflict',
            `the name ${JSON.stringify(body.name)} is already in use`,
          ),
        );
      case 'created':
        return reply
          .code(201)
          .send({ tenant: outcome.tenant, client_secrets: outcome.clientSecrets });
    }
  };
}
