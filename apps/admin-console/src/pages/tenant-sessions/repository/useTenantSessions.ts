import type { SessionsEnded, TenantSession } from '#/pages/tenant-sessions/types/tenantSession';
import {
  endTenantSessions,
  readTenantSessionPage,
} from '#/pages/tenant-sessions/adapter/tenantSessions';
import { countKey, listKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import { useWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import type { GatewayResult } from '#/shared/lib/services/result';

export function useTenantSessionList(tenant: string): ResourceListState<TenantSession> {
  return useResourceList({
    tenant,
    resource: 'sessions',
    read: (gateway, query) => readTenantSessionPage(gateway, tenant, query),
  });
}

// Ending sessions revokes their grants, so every list of the tenant is read
// again: this one, each subject's and each client's.
export function useEndTenantSessions(tenant: string): Write<'all', GatewayResult<SessionsEnded>> {
  const { invalidate } = useInvalidate();
  return useWrite({
    send: (gateway) => endTenantSessions(gateway, tenant),
    onSettled: () => {
      invalidate(listKey(tenant), countKey(tenant));
    },
  });
}
