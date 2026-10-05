import type { Group } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { useGroupRecord, useGroupTrail } from '#/features/groups/repository/useGroupRecord.ts';
import {
  GROUP_TABS,
  groupReach,
  groupRecord,
  groupRolesRecord,
  reachLines,
  type GroupTab,
  type Reach,
  type ReachLines,
} from '#/features/groups/service.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';

// What a group's members receive through it, once it and the caller's own
// capabilities are both known: every ceiling on its writes is judged by it.
export type Ceiling =
  | { status: 'checking' }
  | { status: 'failed'; retry: () => void }
  | { status: 'ready'; reach: Reach; caller: readonly AdminCapability[]; lines: ReachLines };

export interface GroupRecordPage {
  record: RecordView;
  group: Group | undefined;
  etag: string | null;
  tab: GroupTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<GroupTab>;
  ceiling: Ceiling;
}

export function useGroupRecordPage(tenant: string, id: string): GroupRecordPage {
  const record = useGroupRecord(tenant, id);
  const authority = useAuthority(tenant);
  const trail = useGroupTrail(tenant, id);
  const { tab, selectTab } = useRecordTab(GROUP_TABS);
  const general = useDirtySections(tenant, groupRecord(id));
  const roles = useDirtySections(tenant, groupRolesRecord(id));
  const dirty = new Set<GroupTab>([
    ...(general.size > 0 ? (['general'] as const) : []),
    ...(roles.size > 0 ? (['roles'] as const) : []),
  ]);
  let ceiling: Ceiling = { status: 'checking' };
  if (trail.status === 'failed') {
    ceiling = { status: 'failed', retry: trail.retry };
  } else if (trail.status === 'ready' && authority !== undefined && record.data !== undefined) {
    const reach = groupReach(tenant, trail.steps);
    ceiling = {
      status: 'ready',
      reach,
      caller: authority.capabilities,
      lines: reachLines(record.data.path, reach, authority.capabilities),
    };
  }
  return {
    record,
    group: record.data,
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
