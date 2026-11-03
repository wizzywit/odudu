import type { Role } from '#/entities/role';
import { useRoleList } from '#/features/roles/repository/useRoleList';
import { newRoleHref, roleHref } from '#/features/roles/services/roleAddress';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type RolesList = ListPageState<Role>;

export function useRolesList(tenant: string): RolesList {
  return useListPage(useRoleList(tenant), newRoleHref(tenant), (id) => roleHref(tenant, id));
}
