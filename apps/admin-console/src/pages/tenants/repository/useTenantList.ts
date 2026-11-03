import type { Tenant } from '#/pages/tenants/types/tenant';
import { readTenantCount, readTenantPage } from '#/pages/tenants/adapter/tenants';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';

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
