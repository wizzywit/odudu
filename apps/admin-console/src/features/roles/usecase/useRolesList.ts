import type { Role } from '@odudu/contracts/admin';
import { useGo } from '#/features/roles/repository/useGo.ts';
import { useRoleList } from '#/features/roles/repository/useRoleList.ts';
import { newRoleHref, roleHref } from '#/features/roles/service';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface RolesList {
  list: ResourceListState<Role>;
  createHref: string;
  open: (id: string) => void;
}

export function useRolesList(tenant: string): RolesList {
  const list = useRoleList(tenant);
  const go = useGo();
  return {
    list,
    createHref: newRoleHref(tenant),
    open: (id) => {
      go(roleHref(tenant, id));
    },
  };
}
