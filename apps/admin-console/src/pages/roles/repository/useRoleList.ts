import type { Role } from '#/entities/role';
import { readRoleCount, readRolePage } from '#/pages/roles/adapter/roles';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';

export function useRoleList(tenant: string): ResourceListState<Role> {
  return useResourceList({
    tenant,
    resource: 'roles',
    search: ['name'],
    filters: ['client'],
    read: (gateway, query) => readRolePage(gateway, tenant, query),
    count: (gateway, query) => readRoleCount(gateway, tenant, query),
  });
}
