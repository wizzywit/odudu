import { useDirtyRecords } from '#/shared/lib/repository/useDirtyRecords';
import { useRecordTab } from '#/shared/lib/repository/useRecordTab';
import { dirtyTabs, tabNamed } from '#/shared/lib/services/record';

export interface RecordTabs<T extends string> {
  tab: T;
  // A name the record has no tab for changes nothing.
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<T>;
}

// A record page's tabs: the one in the URL, and which of them hold edits.
// `recordsOf` names the records whose sections each tab edits.
export function useRecordTabs<T extends string>(
  tabs: readonly [T, ...T[]],
  recordsOf: Readonly<Record<T, (id: string) => readonly string[]>>,
  tenant: string,
  id: string,
): RecordTabs<T> {
  const { tab, selectTab } = useRecordTab(tabs);
  const records = (each: T): readonly string[] => recordsOf[each](id);
  const edited = useDirtyRecords(tenant, tabs.flatMap(records));
  return {
    tab,
    selectTab: (next) => {
      const chosen = tabNamed(tabs, next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: dirtyTabs(tabs, records, edited),
  };
}
