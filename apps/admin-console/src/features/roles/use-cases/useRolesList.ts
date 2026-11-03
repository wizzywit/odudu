import { useRoleList } from '#/features/roles/repository/useRoleList';
import { type Role, newRoleHref, roleHref } from '#/entities/role';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export type RolesList = ListPageState<Role>;

export function useRolesList(tenant: string): RolesList {
  return useListPage(useRoleList(tenant), newRoleHref(tenant), (id) => roleHref(tenant, id));
}
