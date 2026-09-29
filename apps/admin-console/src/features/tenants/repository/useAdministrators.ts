import type { Subject } from '@odudu/contracts/admin';
import {
  readAdministratorCount,
  readAdministratorPage,
} from '#/features/tenants/adapter/administrators.ts';
import { administratorCapability } from '#/features/tenants/service.ts';
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
