import { newGroupHref, type GroupRecord } from '#/entities/group';
import { useAuthority } from '#/entities/session';
import { useGroupNamed, useGroupRecord } from '#/pages/groups/repository/useGroupRecord';
import { type GroupCeiling, groupCeiling } from '#/pages/groups/services/groupCeiling';
import { createUnderHref } from '#/pages/groups/services/groupCreation';
import {
  GROUP_TAB_LABELS,
  GROUP_TABS,
  type GroupTab,
  TAB_RECORDS,
} from '#/pages/groups/services/tabs';
import { type RecordView, tabEntries, type TabEntry } from '#/shared/lib/services/record';
import { useRecordTabs } from '#/shared/lib/use-cases/useRecordTabs';

export type { GroupCeiling };

export interface GroupRecordPage {
  record: RecordView;
  group: GroupRecord | undefined;
  etag: string | null;
  tab: GroupTab;
  selectTab: (tab: string) => void;
  // Each tab with its label and whether it holds unsaved edits, for its dot.
  tabList: readonly TabEntry<GroupTab>[];
  ceiling: GroupCeiling;
  // A group made under this one receives what it hands out, so it is offered
  // only to a caller holding all of that.
  createUnderHref: string | null;
}

export function useGroupRecordPage(tenant: string, id: string): GroupRecordPage {
  const record = useGroupRecord(tenant, id);
  const authority = useAuthority(tenant);
  const parent = useGroupNamed(tenant, record.data?.parent_id ?? null);
  const tabs = useRecordTabs(GROUP_TABS, TAB_RECORDS, tenant, id);
  const ceiling = groupCeiling(parent, authority, record.data);

  return {
    record,
    group: record.data,
    createUnderHref: createUnderHref(tenant, record.data, ceiling, newGroupHref),
    etag: record.etag,
    tab: tabs.tab,
    selectTab: tabs.selectTab,
    tabList: tabEntries(GROUP_TABS, GROUP_TAB_LABELS, tabs.dirty),
    ceiling,
  };
}
