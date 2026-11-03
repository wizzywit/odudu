import type { Tenant } from '#/pages/tenants/types/tenant';
import { useAuthority } from '#/entities/session';
import { useTenantRecord } from '#/pages/tenants/repository/useTenantRecord';
import { tenantRecordAccess, type TenantRecordAccess } from '#/pages/tenants/services/access';
import {
  tenantRecord,
  TENANT_TABS,
  type TenantTab,
} from '#/pages/tenants/services/tenantRecordTabs';
import type { Crumb } from '#/shared/lib/services/breadcrumb';
import { tenantsTrail } from '#/pages/tenants/services/systemTrail';
import { tenantPage } from '#/shared/lib/services/address';
import { useDirtySections } from '#/shared/lib/repository/useDirtySections';
import { useRecordTab } from '#/shared/lib/repository/useRecordTab';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';
import { tabNamed, type RecordView } from '#/shared/lib/services/record';

export interface TenantRecordPage {
  record: RecordView;
  tenant: Tenant | undefined;
  etag: string | null;
  tab: TenantTab;
  selectTab: (tab: string) => void;
  dirty: ReadonlySet<string>;
}

export function useTenantRecordPage(name: string): TenantRecordPage {
  const record = useTenantRecord(name);
  const { tab, selectTab } = useRecordTab(TENANT_TABS);
  const dirty = useDirtySections(SYSTEM_TENANT, tenantRecord(name));
  return {
    record,
    tenant: record.data,
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = tabNamed(TENANT_TABS, next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty,
  };
}

// Asked above the record's own reads, so a re-render of those never asks whoami.
export function useTenantRecordAccess(name: string): TenantRecordAccess {
  return tenantRecordAccess(useAuthority(SYSTEM_TENANT), name);
}

// The way back and the way into the tenant, which the record names before and
// after its own reads.
export function useTenantRecordFrame(name: string): {
  breadcrumb: readonly Crumb[];
  enterHref: string;
} {
  return { breadcrumb: tenantsTrail(name), enterHref: tenantPage(name) };
}
