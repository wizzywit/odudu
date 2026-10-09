import type { GroupRecord } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGroupNamed, useGroupRecord } from '#/features/groups/repository/useGroupRecord.ts';
import {
  type Ceiling,
  createUnderHref,
  GROUP_TABS,
  groupCeiling,
  type GroupTab,
  TAB_RECORDS,
} from '#/features/groups/service';
import { useDirtyRecords } from '#/shared/repository/useDirtyRecords.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { dirtyTabs, tabNamed, type RecordView } from '#/shared/service/record.ts';

export type { Ceiling };

export interface GroupRecordPage {
  record: RecordView;
  group: GroupRecord | undefined;
  etag: string | null;
  tab: GroupTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<GroupTab>;
  ceiling: Ceiling;
  // A group made under this one receives what it hands out, so it is offered
  // only to a caller holding all of that.
  createUnderHref: string | null;
}

export function useGroupRecordPage(tenant: string, id: string): GroupRecordPage {
  const record = useGroupRecord(tenant, id);
  const authority = useAuthority(tenant);
  const parent = useGroupNamed(tenant, record.data?.parent_id ?? null);
  const { tab, selectTab } = useRecordTab(GROUP_TABS);
  const recordsOf = (each: GroupTab): readonly string[] => TAB_RECORDS[each](id);
  const edited = useDirtyRecords(tenant, GROUP_TABS.flatMap(recordsOf));
  const ceiling = groupCeiling(parent, authority, record.data);

  return {
    record,
    group: record.data,
    createUnderHref: createUnderHref(tenant, record.data, ceiling),
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = tabNamed(GROUP_TABS, next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: dirtyTabs(GROUP_TABS, recordsOf, edited),
    ceiling,
  };
}
