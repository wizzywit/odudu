import type { Tenant } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
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
  readonly record: RecordView;
  readonly tenant: Tenant | undefined;
  readonly etag: string | null;
  readonly tab: TenantTab;
  readonly selectTab: (tab: string) => void;
  readonly dirty: ReadonlySet<string>;
  // Whether whoami lets the caller change the tenant's own fields and status.
  readonly canChange: boolean;
  // What adding an administrator needs that whoami says is missing.
  readonly addNeeds: readonly AdminCapability[];
  // The changes whoami rules out, for the page's one line.
  readonly blocked: Change | null;
}

export function useTenantRecordPage(name: string): TenantRecordPage {
  const record = useTenantRecord(name);
  const { tab, selectTab } = useRecordTab(TENANT_TABS);
  const dirty = useDirtySections(SYSTEM_TENANT, tenantRecord(name));
  const authority = useAuthority(SYSTEM_TENANT);
  const adding = administratorNeeds(name, { subjectId: null, granted: false });
  return {
    canChange: lacking(authority, ['manage-tenant']).length === 0,
    addNeeds: lacking(authority, adding),
    blocked: blockedChanges(authority, [
      { change: 'change them', needs: ['manage-tenant'] },
      { change: 'add their administrators', needs: adding },
    ]),
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
