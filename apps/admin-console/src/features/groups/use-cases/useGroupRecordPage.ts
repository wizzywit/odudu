import type { GroupRecord } from '@odudu/contracts/admin';
import { useAuthority } from '#/entities/session';
import { useGroupNamed, useGroupRecord } from '#/features/groups/repository/useGroupRecord';
import { type Ceiling, groupCeiling } from '#/features/groups/services/groupCeiling';
import { createUnderHref } from '#/features/groups/services/groupCreation';
import { GROUP_TABS, type GroupTab, TAB_RECORDS } from '#/features/groups/services/tabs';
import type { RecordView } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

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
  const tabs = useRecordTabs(GROUP_TABS, TAB_RECORDS, tenant, id);
  const ceiling = groupCeiling(parent, authority, record.data);

  return {
    record,
    group: record.data,
    createUnderHref: createUnderHref(tenant, record.data, ceiling),
    etag: record.etag,
    ...tabs,
    ceiling,
  };
}
