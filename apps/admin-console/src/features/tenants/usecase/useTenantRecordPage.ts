import type { Tenant } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useTenantRecord } from '#/features/tenants/repository/useTenantRecord.ts';
import {
  tenantRecord,
  tenantRecordAccess,
  TENANT_TABS,
  type TenantRecordAccess,
  type TenantTab,
} from '#/features/tenants/service';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { tabNamed, type RecordView } from '#/shared/service/record.ts';

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
