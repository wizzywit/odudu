import type { Subject } from '@odudu/contracts/admin';
import { readAdministratorCount, readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { administratorCapability } from '#/shared/service/administrators.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// Everybody holding what the last-administrator guard counts, effectively:
// directly, through a group, or nested under another role.
export function useAdministrators(tenant: string): ResourceListState<Subject> {
  return useResourceList({
    tenant,
    resource: 'administrators',
    search: ['username'],
    fixed: { capability: administratorCapability(tenant) },
    read: (gateway, query) => readAdministratorPage(gateway, tenant, query),
    count: (gateway, query) => readAdministratorCount(gateway, tenant, query),
  });
}
