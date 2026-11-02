import type { ClientScope } from '@odudu/contracts/admin';
import { readScopeCount, readScopePage } from '#/features/scopes/adapter/scopes';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';

export function useScopeList(tenant: string): ResourceListState<ClientScope> {
  return useResourceList({
    tenant,
    resource: 'scopes',
    search: ['name'],
    read: (gateway, query) => readScopePage(gateway, tenant, query),
    count: (gateway, query) => readScopeCount(gateway, tenant, query),
  });
}
