import type { Tenant } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { useTenantList } from '#/features/tenants/repository/useTenantList.ts';
import { tenantHref } from '#/features/tenants/service.ts';
import { lacking } from '#/shared/service/access.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface TenantsList {
  list: ResourceListState<Tenant>;
  // Null when whoami says a record could not be read: its rows open nothing.
  open: ((name: string) => void) | null;
  // What reading a tenant's record needs that whoami says is missing.
  recordNeeds: readonly AdminCapability[];
}

export function useTenantsList(): TenantsList {
  const list = useTenantList();
  const go = useGo();
  const recordNeeds = lacking(useAuthority(SYSTEM_TENANT), ['manage-tenant']);
  return {
    list,
    recordNeeds,
    open:
      recordNeeds.length > 0
        ? null
        : (name) => {
            go(tenantHref(name));
          },
  };
}
