import type { Tenant } from '@odudu/contracts/admin';
import { useTenantRecord } from '#/features/tenants/repository/useTenantRecord.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';
import { tenantRecord } from '#/features/tenants/repository/useTenantRecord.ts';

export const TENANT_TABS = ['general', 'administrators', 'export'] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

export interface TenantRecordPage {
  readonly record: RecordView;
  readonly tenant: Tenant | undefined;
  readonly etag: string | null;
  readonly tab: TenantTab;
  readonly selectTab: (tab: string) => void;
  readonly dirty: ReadonlySet<string>;
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
      const chosen = TENANT_TABS.find((candidate) => candidate === next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty,
  };
}
