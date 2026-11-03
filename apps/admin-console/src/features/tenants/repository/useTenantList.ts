import type { Tenant } from '#/features/tenants/types/tenant';
import { readTenantCount, readTenantPage } from '#/features/tenants/adapter/tenants';
import { useResourceList } from '#/shared/repository/useResourceList';
import type { ResourceListState } from '#/shared/services/resourceList';
import { SYSTEM_TENANT } from '#/shared/services/principal';

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
