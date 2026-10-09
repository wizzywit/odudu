import type { Role } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useRoleRecord } from '#/features/roles/repository/useRoleRecord.ts';
import {
  type Ceiling,
  copyHrefOf,
  ROLE_TABS,
  roleCeiling,
  type RoleTab,
  TAB_RECORDS,
} from '#/features/roles/service';
import { useDirtyRecords } from '#/shared/repository/useDirtyRecords.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { dirtyTabs, tabNamed, type RecordView } from '#/shared/service/record.ts';

export type { Ceiling };

export interface RoleRecordPage {
  record: RecordView;
  role: Role | undefined;
  etag: string | null;
  // A copy is a tenant role, so only a tenant role offers one.
  copyHref: string | null;
  tab: RoleTab;
  selectTab: (tab: string) => void;
  dirty: ReadonlySet<RoleTab>;
  ceiling: Ceiling;
}

export function useRoleRecordPage(tenant: string, id: string): RoleRecordPage {
  const record = useRoleRecord(tenant, id);
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(ROLE_TABS);
  const recordsOf = (each: RoleTab): readonly string[] => TAB_RECORDS[each](id);
  const edited = useDirtyRecords(tenant, ROLE_TABS.flatMap(recordsOf));
  const role = record.data;

  return {
    record,
    role,
    etag: record.etag,
    copyHref: copyHrefOf(tenant, role),
    tab,
    selectTab: (next) => {
      const chosen = tabNamed(ROLE_TABS, next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: dirtyTabs(ROLE_TABS, recordsOf, edited),
    ceiling: roleCeiling(role, authority),
  };
}
