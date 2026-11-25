import {
  agentInstanceSchema,
  listAgentApprovalsResponseSchema,
  listAgentsResponseSchema,
  revokeAgentResponseSchema,
  type AgentApproval as WireApproval,
  type AgentInstance as WireInstance,
  type ListAgentApprovalsResponse,
  type ListAgentsResponse,
} from '@odudu/contracts/admin';
import { adminCall, listReader, mapResult } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { ListPage } from '#/shared/lib/services/resourceList';
import type { AgentApproval, AgentInstance, RevokeCount } from '#/pages/agents/types/agent';

const readWireAgents = listReader('agents', listAgentsResponseSchema);
const readWireApprovals = listReader('agent-approvals', listAgentApprovalsResponseSchema);

function instanceOf(wire: WireInstance): AgentInstance {
  return {
    id: wire.id,
    owner: wire.owner,
    ownerUsername: wire.owner_username,
    agentClient: wire.agent_client,
    parent: wire.parent,
    depth: wire.depth,
    state: wire.state,
    scope: wire.scope,
    createdAt: wire.created_at,
    expiresAt: wire.expires_at,
    revokedAt: wire.revoked_at,
    budget: wire.remaining_budget,
  };
}

function approvalOf(wire: WireApproval): AgentApproval {
  return {
    id: wire.id,
    owner: wire.owner,
    ownerUsername: wire.owner_username,
    agentClient: wire.agent_client,
    instance: wire.instance,
    kind: wire.kind,
    summary: wire.summary,
    state: wire.state,
    createdAt: wire.created_at,
    expiresAt: wire.expires_at,
    decidedAt: wire.decided_at,
    decidedVia: wire.decided_via,
  };
}

function instancePage(wire: ListAgentsResponse): ListPage<AgentInstance> {
  return { items: wire.items.map(instanceOf), next: wire.next };
}

function approvalPage(wire: ListAgentApprovalsResponse): ListPage<AgentApproval> {
  return { items: wire.items.map(approvalOf), next: wire.next };
}

export async function readAgentPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<AgentInstance>>> {
  return mapResult(await readWireAgents(gateway, tenant, query), instancePage);
}

export async function readApprovalPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListPage<AgentApproval>>> {
  return mapResult(await readWireApprovals(gateway, tenant, query), approvalPage);
}

export async function readAgent(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<AgentInstance>> {
  const result = await adminCall(gateway, 'GET', tenant, ['agents', id], {
    schema: agentInstanceSchema,
  });
  return mapResult(result, instanceOf);
}

// Revokes the run and everything beneath it. With `dryRun` the server answers
// what it would end and changes nothing.
export function revokeAgent(
  gateway: Gateway,
  tenant: string,
  id: string,
  dryRun: boolean,
): Promise<GatewayResult<RevokeCount>> {
  return adminCall(gateway, 'DELETE', tenant, ['agents', id], {
    ...(dryRun ? { query: new URLSearchParams({ dry_run: 'true' }) } : {}),
    schema: revokeAgentResponseSchema,
  });
}
