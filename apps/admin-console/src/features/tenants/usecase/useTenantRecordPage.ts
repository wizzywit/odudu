import type { Tenant } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useTenantRecord } from '#/features/tenants/repository/useTenantRecord.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { blockedChanges, lacking, type Change } from '#/shared/service/access.ts';
import { administratorNeeds } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';
import { tenantRecord } from '#/features/tenants/repository/useTenantRecord.ts';

export const TENANT_TABS = ['general', 'administrators', 'export'] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

export interface TenantRecordPage {
  record: RecordView;
  tenant: Tenant | undefined;
  etag: string | null;
  tab: TenantTab;
  selectTab: (tab: string) => void;
  dirty: ReadonlySet<string>;
}

export interface TenantRecordAccess {
  // What reading the record needs that whoami says is missing.
  readNeeds: readonly AdminCapability[];
  // What adding an administrator needs that whoami says is missing.
  addNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  blocked: Change | null;
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

// A tenant's record is read with manage-tenant, which the System area's own
// manage-tenants does not carry; its address still opens, and says so. Asked
// above the record's own reads, so a re-render of those never asks whoami.
export function useTenantRecordAccess(name: string): TenantRecordAccess {
  const authority = useAuthority(SYSTEM_TENANT);
  const adding = administratorNeeds(name, { subjectId: null, granted: false });
  const readNeeds = lacking(authority, ['manage-tenant']);
  return {
    readNeeds,
    addNeeds: lacking(authority, adding),
    blocked: blockedChanges(authority, [{ change: 'add their administrators', needs: adding }]),
  };
}
