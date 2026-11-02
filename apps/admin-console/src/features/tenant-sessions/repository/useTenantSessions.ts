import type { EndTenantSessionsResponse, TenantSession } from '@odudu/contracts/admin';
import {
  endTenantSessions,
  readTenantSessionPage,
} from '#/features/tenant-sessions/adapter/tenantSessions';
import { countKey, listKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useResourceList } from '#/shared/repository/useResourceList';
import { useWrite, type Write } from '#/shared/repository/useWrite';
import type { ResourceListState } from '#/shared/services/resourceList';
import type { GatewayResult } from '#/shared/services/result';

export function useTenantSessionList(tenant: string): ResourceListState<TenantSession> {
  return useResourceList({
    tenant,
    resource: 'sessions',
    read: (gateway, query) => readTenantSessionPage(gateway, tenant, query),
  });
}

// Ending sessions revokes their grants, so every list of the tenant is read
// again: this one, each subject's and each client's.
export function useEndTenantSessions(
  tenant: string,
): Write<'all', GatewayResult<EndTenantSessionsResponse>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: (gateway) => endTenantSessions(gateway, tenant),
    onSettled: () => {
      invalidate(listKey(tenant), countKey(tenant));
    },
  });
}
