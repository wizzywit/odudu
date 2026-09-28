import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';

const PARAM = 'tab';

// A record's tab is position, so it lives in the URL; a tab the record does
// not have falls back to its first.
export function useRecordTab<T extends string>(
  tabs: readonly [T, ...T[]],
): { readonly tab: T; readonly selectTab: (tab: T) => void } {
  const { params, go } = useUrlSearch();
  const asked = params.get(PARAM);
  const tab = tabs.find((candidate) => candidate === asked) ?? tabs[0];
  return {
    tab,
    selectTab: (next) => {
      if (next === tab) return;
      const search = new URLSearchParams(params);
      search.set(PARAM, next);
      go(search);
    },
  };
}
