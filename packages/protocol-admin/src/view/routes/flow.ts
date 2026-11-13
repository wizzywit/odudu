import {
  FLOW_LIMIT,
  replaceExecutionsRequestSchema,
  saveFlowRequestSchema,
} from '@odudu/contracts/admin';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  violatedConstraint,
  type Database,
} from '@odudu/db';
import {
  amendFlow,
  createFlow,
  deleteFlow,
  listFlow,
  listFlows,
  makeFlowDefault,
  readFlow,
  replaceFlow,
  type Audit,
  type StepsRefusal,
} from '#/usecase/flow';
import {
  bodyProblem,
  fieldProblem,
  ifMatchRequired,
  ifMatchStale,
  problem,
  sendProblem,
  type Problem,
} from '#/view/problem';
import { flowInUseDetail } from '#/service/client-flow';
import { etagOf } from '#/service/etag';
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
    return reply.code(200).send({ items: flow.items, available: flow.available });
  };
}

// The step a refusal is about, by its index in the request: the one naming
// `name`, or, for a repeat, the first after the one that came before it. A
// body that wraps the list names it under `prefix`.
function stepPath(
  steps: readonly { authenticator: string }[],
  name: string,
  nth: number,
  prefix: string,
): string {
  const indices = steps.flatMap((step, index) => (step.authenticator === name ? [index] : []));
  return `${prefix}[${String(indices[nth] ?? indices[0] ?? 0)}].authenticator`;
}

function stepsProblem(
  outcome: StepsRefusal,
  steps: readonly { authenticator: string }[],
  prefix: string,
): Problem {
  switch (outcome.kind) {
    case 'empty':
      return problem(
        400,
        'about:blank#flow-empty',
        'Bad Request',
        'a flow needs at least one step; a tenant with no flow cannot be logged into',
      );
    case 'unresolvable_authenticator':
      return fieldProblem(
        [
          {
            path: stepPath(steps, outcome.name, 0, prefix),
            message: 'is not a registered authenticator',
          },
        ],
        `unknown authenticator ${JSON.stringify(outcome.name)}; expected one of ${outcome.known.join(', ')}`,
        'about:blank#flow-unknown-authenticator',
      );
    case 'duplicate_authenticator':
      return fieldProblem(
        [{ path: stepPath(steps, outcome.name, 1, prefix), message: 'repeats an earlier step' }],
        `authenticator ${JSON.stringify(outcome.name)} appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning`,
        'about:blank#flow-duplicate-authenticator',
      );
    case 'no_enabled_step':
      return problem(
        400,
        'about:blank#flow-no-enabled-step',
        'Bad Request',
        'every step is disabled; a tenant with no enabled step cannot be logged into',
      );
    case 'no_step_runnable_at_start':
      return problem(
        400,
        'about:blank#flow-no-first-challenge',
        'Bad Request',
        'no step would run at the start of a login, when no subject is bound yet; ' +
          'a tenant whose flow begins this way cannot be logged into',
      );
  }
}

function replaceFlowProblem(
  outcome: Exclude<Awaited<ReturnType<typeof replaceFlow>>, { kind: 'ok' }>,
  steps: readonly { authenticator: string }[],
  sent: string | string[] | undefined,
): Problem {
  switch (outcome.kind) {
    case 'precondition_required':
      return ifMatchRequired('a tenant\u2019s authentication flow', sent);
    case 'precondition_failed':
      return ifMatchStale();
    default:
      return stepsProblem(outcome, steps, '');
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
      return sendProblem(
        reply,
        request,
        replaceFlowProblem(outcome, steps, request.headers['if-match']),
      );
    }
    reply.header('etag', outcome.etag);
    return reply.code(200).send({ items: outcome.items, available: outcome.available });
  };
}

function flowId(request: AdminRequest, verb: string): string {
  const id = request.params.id;
  if (id === undefined) throw new Error(`protocol-admin: ${verb} flow route received no :id`);
  return id;
}

function flowNotFound(id: string): Problem {
  return problem(404, 'about:blank', 'Not Found', `no flow ${id}`);
}

function flowNameTaken(name: string): Problem {
  return problem(
    409,
    'about:blank#flow-name-taken',
    'Conflict',
    `a flow named ${JSON.stringify(name)} already exists`,
  );
}

export function listFlowsHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const listed = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listFlows(tx, targetTenantId),
    );
    reply.header('etag', etagOf(listed.items));
    return reply.code(200).send(listed);
  };
}

export function readFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = flowId(request, 'GET');
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readFlow(tx, targetTenantId, id),
    );
    if (outcome.kind === 'not_found') return sendProblem(reply, request, flowNotFound(id));
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.flow);
  };
}

export function createFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const parsed = saveFlowRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendProblem(reply, request, bodyProblem(parsed.error));
    const body = parsed.data;
    let outcome: Awaited<ReturnType<typeof createFlow>>;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        createFlow(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            name: body.name,
            steps: body.steps,
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return sendProblem(reply, request, flowNameTaken(body.name));
    }

    if (outcome.kind === 'flow_limit') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank#flow-limit',
          'Conflict',
          `a tenant holds at most ${String(FLOW_LIMIT)} flows`,
        ),
      );
    }
    if (outcome.kind !== 'ok') {
      return sendProblem(reply, request, stepsProblem(outcome, body.steps, 'steps'));
    }
    reply.header('etag', outcome.etag);
    return reply.code(201).send(outcome.flow);
  };
}

export function amendFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = flowId(request, 'PUT');
    const parsed = saveFlowRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendProblem(reply, request, bodyProblem(parsed.error));
    const body = parsed.data;
    let outcome: Awaited<ReturnType<typeof amendFlow>>;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        amendFlow(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            flowId: id,
            name: body.name,
            steps: body.steps,
            ifMatch: ifMatchHeader(request),
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return sendProblem(reply, request, flowNameTaken(body.name));
    }

    switch (outcome.kind) {
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.flow);
      case 'not_found':
        return sendProblem(reply, request, flowNotFound(id));
      case 'precondition_required':
        return sendProblem(reply, request, ifMatchRequired('a flow', request.headers['if-match']));
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
      default:
        return sendProblem(reply, request, stepsProblem(outcome, body.steps, 'steps'));
    }
  };
}

// Named by migration 0138: the key a client's `flow_id` holds into `flows`.
const CLIENT_FLOW_FK = 'client_oidc_config_flow_fk';

export function deleteFlowHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = flowId(request, 'DELETE');
    let outcome: Awaited<ReturnType<typeof deleteFlow>>;
    try {
      outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
        deleteFlow(
          tx,
          { audit: deps.audit },
          {
            tenantId: targetTenantId,
            flowId: id,
            ifMatch: ifMatchHeader(request),
            actorSubjectId: principal.subjectId,
            actorTenantId: principal.issuerTenantId,
            actorClientId: principal.clientDbId,
          },
        ),
      );
    } catch (error) {
      // A client pointed at the flow after the count was taken.
      if (!isForeignKeyViolation(error) || violatedConstraint(error) !== CLIENT_FLOW_FK)
        throw error;
      outcome = { kind: 'in_use', count: 0, sample: [] };
    }
    if (outcome.kind === 'not_found') return sendProblem(reply, request, flowNotFound(id));
    if (outcome.kind === 'precondition_required') {
      return sendProblem(
        reply,
        request,
        ifMatchRequired('a flow', request.headers['if-match'], { to: 'delete', ing: 'deleting' }),
      );
    }
    if (outcome.kind === 'precondition_failed') return sendProblem(reply, request, ifMatchStale());
    if (outcome.kind === 'default_flow') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank#default-flow',
          'Conflict',
          'the default flow is not deleted; make another flow the default first',
        ),
      );
    }
    if (outcome.kind === 'in_use') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank#flow-in-use', 'Conflict', flowInUseDetail(outcome)),
      );
    }
    return reply.code(204).send();
  };
}

export function makeFlowDefaultHandler(deps: FlowRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = flowId(request, 'POST make-default');
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      makeFlowDefault(
        tx,
        { audit: deps.audit },
        {
          tenantId: targetTenantId,
          flowId: id,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    );
    switch (outcome.kind) {
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.flow);
      case 'not_found':
        return sendProblem(reply, request, flowNotFound(id));
      case 'precondition_required':
        return sendProblem(
          reply,
          request,
          ifMatchRequired('a flow the default', request.headers['if-match'], {
            to: 'make',
            ing: 'making',
          }),
        );
      case 'precondition_failed':
        return sendProblem(reply, request, ifMatchStale());
    }
  };
}
