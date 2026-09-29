import type { Subject } from '@odudu/contracts/admin';
import { readAdministratorPage } from '#/features/tenants/adapter/administrators.ts';
import { TENANT_ADMIN } from '#/features/tenants/service.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// Everybody holding tenant-admin effectively: directly, through a group,
// or nested under another role.
export function useAdministrators(tenant: string): ResourceListState<Subject> {
  return useResourceList({
    tenant,
    resource: 'administrators',
    search: ['username'],
    fixed: { capability: TENANT_ADMIN },
    read: (gateway, query) => readAdministratorPage(gateway, tenant, query),
  });
}
