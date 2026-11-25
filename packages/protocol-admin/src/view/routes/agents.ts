import {
  deleteAgentQuerySchema,
  listAgentApprovalsQuerySchema,
  listAgentsQuerySchema,
  type AgentApproval,
  type AgentInstance,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { instanceState, remainingBudget } from '#/service/agent-view';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  listAgentApprovals,
  listAgents,
  readAgent,
  revokeAgent,
  type AgentApprovalView,
  type AgentInstanceView,
  type Audit,
} from '#/usecase/agents';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingProblem } from '#/view/routes/subjects';

export interface AgentsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: Audit;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  readonly now: () => Date;
}

function instanceWireShape(view: AgentInstanceView, now: Date): AgentInstance {
  const { instance } = view;
  return {
    id: instance.id,
    owner: instance.ownerSubjectId,
    owner_username: view.ownerUsername,
    agent_client: view.agentClient,
    parent: instance.parentInstanceId,
    depth: instance.depth,
    state: instanceState(instance, now),
    scope: instance.scope,
    created_at: instance.createdAt.toISOString(),
    expires_at: instance.expiresAt.toISOString(),
    revoked_at: instance.revokedAt?.toISOString() ?? null,
    remaining_budget: remainingBudget(instance),
  };
}

function approvalWireShape(view: AgentApprovalView): AgentApproval {
  const { approval } = view;
  return {
    id: approval.id,
    owner: approval.subjectId,
    owner_username: view.ownerUsername,
    agent_client: view.agentClient,
    instance: approval.instanceId,
    kind: approval.kind,
    summary: approval.summary,
    state: approval.state,
    created_at: approval.createdAt.toISOString(),
    expires_at: approval.expiresAt.toISOString(),
    decided_at: approval.decidedAt?.toISOString() ?? null,
    decided_via: approval.decidedVia,
  };
}

export function listAgentsHandler(deps: AgentsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { cursor, limit: rawLimit, ...filters } = listAgentsQuerySchema.parse(request.query);
    const limit = coerceLimit(rawLimit === undefined ? undefined : String(rawLimit));
    const now = deps.now();
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listAgents(tx, {
        tenantId: targetTenantId,
        filters,
        now,
        limit,
        cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    const items = outcome.items.map((view) => instanceWireShape(view, now));
    if (outcome.next === null) return reply.code(200).send({ items });
    const nextUrl = nextPageUrl(`/admin/tenants/${request.params.tenant ?? ''}/agents`, {
      ...filters,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}

export function readAgentHandler(deps: AgentsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) throw new Error('protocol-admin: GET agent route received no :id');
    const now = deps.now();
    const view = await adminTx(deps.database, request, targetTenantId, (tx) => readAgent(tx, id));
    if (view === null) {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no agent ${id}`),
      );
    }
    return reply.code(200).send(instanceWireShape(view, now));
  };
}

export function revokeAgentHandler(deps: AgentsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = request.params.id;
    if (id === undefined) throw new Error('protocol-admin: DELETE agent route received no :id');
    const query = deleteAgentQuerySchema.parse(request.query);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      revokeAgent(
        tx,
        { audit: deps.audit },
        {
          instanceId: id,
          dryRun: query.dry_run === 'true',
          now: deps.now(),
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
          problem(404, 'about:blank', 'Not Found', `no agent ${id}`),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'revoked':
        return reply.code(200).send({ grants: outcome.grants, instances: outcome.instances });
    }
  };
}

export function listAgentApprovalsHandler(deps: AgentsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const {
      cursor,
      limit: rawLimit,
      ...filters
    } = listAgentApprovalsQuerySchema.parse(request.query);
    const limit = coerceLimit(rawLimit === undefined ? undefined : String(rawLimit));
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listAgentApprovals(tx, {
        tenantId: targetTenantId,
        filters,
        limit,
        cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    const items = outcome.items.map(approvalWireShape);
    if (outcome.next === null) return reply.code(200).send({ items });
    const nextUrl = nextPageUrl(`/admin/tenants/${request.params.tenant ?? ''}/agent-approvals`, {
      ...filters,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items, next: outcome.next });
  };
}
