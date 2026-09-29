import type { Tenant } from '@odudu/contracts/admin';
import { readTenantCount, readTenantPage } from '#/features/tenants/adapter/tenants.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';

export function useTenantList(): ResourceListState<Tenant> {
  return useResourceList({
    tenant: SYSTEM_TENANT,
    resource: 'tenants',
    search: ['name', 'display_name'],
    filters: ['enabled'],
    read: readTenantPage,
    count: readTenantCount,
  });
}
