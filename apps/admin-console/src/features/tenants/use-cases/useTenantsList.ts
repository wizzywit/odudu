import type { Tenant } from '@odudu/contracts/admin';
import { useAuthority } from '#/entities/session';
import { useGo } from '#/shared/repository/useGo';
import { useTenantList } from '#/features/tenants/repository/useTenantList';
import { recordOpener } from '#/features/tenants/services/access';
import { tenantHref } from '#/features/tenants/services/systemAddress';
import { lacking } from '#/shared/services/access';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/services/principal';
import type { ResourceListState } from '#/shared/services/resourceList';

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
    open: recordOpener(recordNeeds, (name) => {
      go(tenantHref(name));
    }),
  };
}
