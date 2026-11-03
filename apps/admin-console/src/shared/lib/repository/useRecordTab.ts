import { useUrlSearch } from '#/shared/lib/repository/useUrlSearch';
import { TAB_PARAM, tabNamed } from '#/shared/lib/services/record';

// A record's tab is position, so it lives in the URL; a tab the record does
// not have falls back to its first. A new tab starts with nothing but its
// name: a list's search or cursor trail belongs to the tab that set it.
export function useRecordTab<T extends string>(
  tabs: readonly [T, ...T[]],
): { tab: T; selectTab: (tab: T) => void } {
  const { params, go } = useUrlSearch();
  const asked = params.get(TAB_PARAM);
  const tab = tabNamed(tabs, asked) ?? tabs[0];
  return {
    tab,
    selectTab: (next) => {
      if (next === tab) return;
      go(new URLSearchParams({ [TAB_PARAM]: next }));
    },
  };
}
