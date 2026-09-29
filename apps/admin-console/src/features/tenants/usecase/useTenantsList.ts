import type { Tenant } from '@odudu/contracts/admin';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { useTenantList } from '#/features/tenants/repository/useTenantList.ts';
import { tenantHref } from '#/features/tenants/service.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface TenantsList {
  readonly list: ResourceListState<Tenant>;
  readonly open: (name: string) => void;
}

export function useTenantsList(): TenantsList {
  const list = useTenantList();
  const go = useGo();
  return {
    list,
    open: (name) => {
      go(tenantHref(name));
    },
  };
}
