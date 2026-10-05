import type { GroupRecord } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useGroupNamed, useGroupRecord } from '#/features/groups/repository/useGroupRecord.ts';
import {
  GROUP_TABS,
  groupRecord,
  newGroupHref,
  groupRolesRecord,
  reachLines,
  type GroupTab,
  type ReachLines,
} from '#/features/groups/service.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { beyondCaller } from '#/shared/service/capabilities.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';

// What its parent hands down beside what the group itself carries, and the
// caller's own capabilities: every ceiling on its writes is judged by them,
// so none is offered until all three are known.
export type Ceiling =
  | { status: 'checking' }
  | { status: 'failed'; retry: () => void }
  | {
      status: 'ready';
      parentReach: readonly string[];
      caller: readonly AdminCapability[];
      lines: ReachLines;
    };

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
  const general = useDirtySections(tenant, groupRecord(id));
  const roles = useDirtySections(tenant, groupRolesRecord(id));
  const dirty = new Set<GroupTab>([
    ...(general.size > 0 ? (['general'] as const) : []),
    ...(roles.size > 0 ? (['roles'] as const) : []),
  ]);
  let ceiling: Ceiling = { status: 'checking' };
  const parentReach =
    parent.status === 'none' ? [] : parent.status === 'ready' ? parent.group.admin_reach : null;
  if (parent.status === 'failed') {
    ceiling = { status: 'failed', retry: parent.retry };
  } else if (parentReach !== null && authority !== undefined && record.data !== undefined) {
    ceiling = {
      status: 'ready',
      parentReach,
      caller: authority.capabilities,
      lines: reachLines(record.data, parentReach, authority.capabilities),
    };
  }
  const createUnderHref =
    ceiling.status === 'ready' &&
    record.data !== undefined &&
    beyondCaller(record.data.admin_reach, ceiling.caller).length === 0
      ? newGroupHref(tenant, id)
      : null;
  return {
    record,
    group: record.data,
    createUnderHref,
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = GROUP_TABS.find((candidate) => candidate === next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty,
    ceiling,
  };
}
