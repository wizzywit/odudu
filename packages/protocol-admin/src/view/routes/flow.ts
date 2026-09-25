import { replaceExecutionsRequestSchema } from '@odudu/contracts/admin';
import { withTenant, type Database } from '@odudu/db';
import { listFlow, replaceFlow, type Audit, type ReplaceFlowOutcome } from '#/usecase/flow';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface FlowRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
}

export function listFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (_request, reply, _principal, targetTenantId) => {
    const items = await withTenant(deps.database, targetTenantId, (tx) =>
      listFlow(tx, targetTenantId),
    );
    return reply.code(200).send({ items });
  };
}

function replaceFlowProblem(outcome: Exclude<ReplaceFlowOutcome, { kind: 'ok' }>) {
  switch (outcome.kind) {
    case 'empty':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        'a flow needs at least one step; a tenant with no flow cannot be logged into',
      );
    case 'unresolvable_authenticator':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        `unknown authenticator ${JSON.stringify(outcome.name)}; expected one of ${outcome.known.join(', ')}`,
      );
    case 'no_enabled_step':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        'every step is disabled; a tenant with no enabled step cannot be logged into',
      );
  }
}

export function replaceFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const steps = replaceExecutionsRequestSchema.parse(request.body);

    const outcome = await withTenant(deps.database, targetTenantId, (tx) =>
      replaceFlow(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          steps,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return sendProblem(reply, request, replaceFlowProblem(outcome));
    }
    return reply.code(200).send({ items: outcome.items });
  };
}
