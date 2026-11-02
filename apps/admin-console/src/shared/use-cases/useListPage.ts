import { useGo } from '#/shared/repository/useGo';
import type { ResourceListState } from '#/shared/services/resourceList';

export interface ListPageState<T, H extends string | null = string> {
  list: ResourceListState<T>;
  createHref: H;
  open: (id: string) => void;
}

// What a resource's list page needs besides its rows: where creating leads
// and how a row opens its record.
export function useListPage<T, H extends string | null>(
  list: ResourceListState<T>,
  createHref: H,
  hrefOf: (id: string) => string,
): ListPageState<T, H> {
  const go = useGo();
  return {
    list,
    createHref,
    open: (id) => {
      go(hrefOf(id));
    },
  };
}
