import { useRoleList } from '#/pages/roles/repository/useRoleList';
import { type Role, newRoleHref, roleHref } from '#/entities/role';
import { NAME_SEARCH } from '#/shared/services/filters';
import { useListPage, type ListPageState } from '#/shared/use-cases/useListPage';

export interface RolesList extends ListPageState<Role> {
  searchFields: readonly { id: string; label: string }[];
}

export function useRolesList(tenant: string): RolesList {
  const page = useListPage(useRoleList(tenant), newRoleHref(tenant), (id) => roleHref(tenant, id));
  return {
    list: page.list,
    createHref: page.createHref,
    open: page.open,
    searchFields: NAME_SEARCH,
  };
}
