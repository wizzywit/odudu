import type { AgentApproval, AgentInstance, RevokeCount } from '#/pages/agents/types/agent';
import {
  readAgent,
  readAgentPage,
  readApprovalPage,
  revokeAgent,
} from '#/pages/agents/adapter/agents';
import { agentKey, revokeCountKey } from '#/pages/agents/repository/queryKeys';
import { useTransport } from '#/shared/api/transport/useTransport';
import { countKey, listKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useRead } from '#/shared/lib/repository/useRead';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Read } from '#/shared/lib/services/read';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import type { GatewayResult } from '#/shared/lib/services/result';

export function useAgentList(tenant: string): ResourceListState<AgentInstance> {
  return useResourceList({
    tenant,
    resource: 'agents',
    filters: ['state', 'owner'],
    read: (gateway, query) => readAgentPage(gateway, tenant, query),
  });
}

export function useApprovalList(tenant: string): ResourceListState<AgentApproval> {
  return useResourceList({
    tenant,
    resource: 'agent-approvals',
    filters: ['state'],
    read: (gateway, query) => readApprovalPage(gateway, tenant, query),
  });
}

// The run as the server holds it now, read when its details are opened.
export function useAgentDetail(tenant: string, id: string, asked: boolean): Read<AgentInstance> {
  const { gateway } = useTransport();
  return useRead(agentKey(tenant, id), asked, () => readAgent(gateway, tenant, id));
}

// What revoking the run would end, counted by the server and changed by nothing.
export function useRevokeCount(tenant: string, id: string, asked: boolean): Read<RevokeCount> {
  const { gateway } = useTransport();
  return useRead(revokeCountKey(tenant, id), asked, () => revokeAgent(gateway, tenant, id, true));
}

// A revoke ends grants as well as runs, so every list of the tenant is read
// again, and so are the details read for the runs it ended.
export function useRevokeAgent(tenant: string): Write<AgentInstance, GatewayResult<RevokeCount>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: (gateway, run) => revokeAgent(gateway, tenant, run.id, false),
    onSettled: () => {
      invalidate(listKey(tenant), countKey(tenant), agentKey(tenant));
    },
  });
}
