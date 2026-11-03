import type { Tenant } from '#/pages/tenants/types/tenant';
import { useAuthority } from '#/entities/session';
import { useGo } from '#/shared/repository/useGo';
import { useTenantList } from '#/pages/tenants/repository/useTenantList';
import { recordOpener } from '#/pages/tenants/services/access';
import {
  IMPORT_TENANT_HREF,
  NEW_TENANT_HREF,
  tenantHref,
} from '#/pages/tenants/services/systemAddress';
import { tenantPage } from '#/shared/services/address';
import { STATUS_FILTER } from '#/shared/services/filters';
import { lacking } from '#/shared/services/access';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/services/principal';
import type { ResourceListState } from '#/shared/services/resourceList';

export interface TenantsList {
  list: ResourceListState<Tenant>;
  // Null when whoami says a record could not be read: its rows open nothing.
  open: ((name: string) => void) | null;
  // What reading a tenant's record needs that whoami says is missing.
  recordNeeds: readonly AdminCapability[];
  // Where each row's Enter link, and the two creating actions, lead.
  enterHref: (name: string) => string;
  importHref: string;
  createHref: string;
  statusFilter: typeof STATUS_FILTER;
}

export function useTenantsList(): TenantsList {
  const list = useTenantList();
  const go = useGo();
  const recordNeeds = lacking(useAuthority(SYSTEM_TENANT), ['manage-tenant']);
  return {
    list,
    recordNeeds,
    enterHref: tenantPage,
    importHref: IMPORT_TENANT_HREF,
    createHref: NEW_TENANT_HREF,
    statusFilter: STATUS_FILTER,
    open: recordOpener(recordNeeds, (name) => {
      go(tenantHref(name));
    }),
  };
}
