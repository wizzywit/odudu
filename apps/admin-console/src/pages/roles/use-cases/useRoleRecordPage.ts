import { newRoleHref, type Role } from '#/entities/role';
import { useAuthority } from '#/entities/session';
import { useRoleRecord } from '#/pages/roles/repository/useRoleRecord';
import { copyHrefOf } from '#/pages/roles/services/roleCopy';
import { type RoleCeiling, roleCeiling } from '#/pages/roles/services/roleCeiling';
import { ROLE_TAB_LABELS, ROLE_TABS, type RoleTab, TAB_RECORDS } from '#/pages/roles/services/tabs';
import { type RecordView, tabEntries, type TabEntry } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

export type { RoleCeiling };

export interface RoleRecordPage {
  record: RecordView;
  role: Role | undefined;
  etag: string | null;
  // A copy is a tenant role, so only a tenant role offers one.
  copyHref: string | null;
  tab: RoleTab;
  selectTab: (tab: string) => void;
  tabList: readonly TabEntry<RoleTab>[];
  ceiling: RoleCeiling;
}

export function useRoleRecordPage(tenant: string, id: string): RoleRecordPage {
  const record = useRoleRecord(tenant, id);
  const authority = useAuthority(tenant);
  const tabs = useRecordTabs(ROLE_TABS, TAB_RECORDS, tenant, id);
  const role = record.data;

  return {
    record,
    role,
    etag: record.etag,
    copyHref: copyHrefOf(newRoleHref(tenant), role),
    tab: tabs.tab,
    selectTab: tabs.selectTab,
    tabList: tabEntries(ROLE_TABS, ROLE_TAB_LABELS, tabs.dirty),
    ceiling: roleCeiling(role, authority),
  };
}
