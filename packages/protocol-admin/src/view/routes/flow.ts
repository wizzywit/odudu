import { replaceExecutionsRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { listFlow, replaceFlow, type Audit, type ReplaceFlowOutcome } from '#/usecase/flow';
import { ifMatchRequired, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface FlowRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

export function listFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const flow = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listFlow(tx, targetTenantId),
    );
    reply.header('etag', flow.etag);
    return reply.code(200).send({ items: flow.items });
  };
}

function replaceFlowProblem(outcome: Exclude<ReplaceFlowOutcome, { kind: 'ok' }>) {
  switch (outcome.kind) {
    case 'precondition_required':
      return ifMatchRequired('a tenant\u2019s authentication flow');
    case 'precondition_failed':
      return ifMatchStale();
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
    case 'duplicate_authenticator':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        `authenticator ${JSON.stringify(outcome.name)} appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning`,
      );
    case 'no_enabled_step':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        'every step is disabled; a tenant with no enabled step cannot be logged into',
      );
    case 'no_step_runnable_at_start':
      return problem(
        400,
        'about:blank',
        'Bad Request',
        'no step would run at the start of a login, when no subject is bound yet; ' +
          'a tenant whose flow begins this way cannot be logged into',
      );
  }
}

export function replaceFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const steps = replaceExecutionsRequestSchema.parse(request.body);

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      replaceFlow(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          steps,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );

    if (outcome.kind !== 'ok') {
      return sendProblem(reply, request, replaceFlowProblem(outcome));
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send({ items: outcome.items });
  };
}
