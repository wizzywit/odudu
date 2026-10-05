import type { Role } from '@odudu/contracts/admin';
import { readRoleCount, readRolePage } from '#/features/roles/adapter/roles.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

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
