import type { CountResponse } from '#/shared/lib/types/count';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { countKey, listKey, pageKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useUrlSearch } from '#/shared/lib/repository/useUrlSearch';
import { currentCursor, trailFromSearch, trailToSearch } from '#/shared/lib/services/cursorTrail';
import { ReadFailure } from '#/shared/lib/services/readFailure';
import {
  apiQuery,
  canLoadMore,
  countOf,
  isNarrowed,
  listFromSearch,
  listPagesState,
  loadLimited,
  listToSearch,
  moreFailed,
  staleCursorOf,
  firstPageFailureOf,
  type ListNarrowing,
  type ListPage,
  type ResourceListState,
  withDefaults,
  withFilter,
} from '#/shared/lib/services/resourceList';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

export type ReadPage<T> = (
  gateway: Gateway,
  query: URLSearchParams,
) => Promise<GatewayResult<ListPage<T>>>;
export type ReadCount = (
  gateway: Gateway,
  query: URLSearchParams,
) => Promise<GatewayResult<CountResponse>>;

// Reads one page of a list at a time, from `cursor` onwards, and keeps the
// pages "Load more" adds in place.
export function useListPages<T>({
  key,
  query,
  cursor,
  read,
  enabled = true,
}: {
  key: readonly unknown[];
  query: URLSearchParams;
  cursor: string | undefined;
  read: ReadPage<T>;
  enabled?: boolean;
}) {
  const { gateway } = useTransport();
  const pages = useInfiniteQuery({
    queryKey: pageKey(key, query, cursor),
    initialPageParam: cursor,
    enabled,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam !== undefined) params.set('cursor', pageParam);
      const result = await read(gateway, params);
      if (!result.ok) throw new ReadFailure(result);
      return result.data;
    },
    getNextPageParam: (last: ListPage<T>) => last.next,
  });
  // Read while rendering: the query result re-renders only for what a render
  // read, so a flag first read inside the handler would be as stale as the
  // render before the refetch it was meant to wait out.
  const state = listPagesState(pages.data, pages.error);
  const loadable = canLoadMore(pages.hasNextPage, pages.isFetching, state.rows.length);
  return {
    ...state,
    loadLimited: loadLimited(pages.hasNextPage, state.rows.length),
    staleCursor: staleCursorOf(pages.data, pages.error),
    failure: firstPageFailureOf(pages.data, pages.error),
    loadingMore: pages.isFetchingNextPage,
    loadMoreFailed: moreFailed(pages.data !== undefined, pages.isFetchNextPageError),
    loadMore: () => {
      if (loadable) {
        pages.fetchNextPage().catch(() => undefined);
      }
    },
    retry: () => {
      pages.refetch().catch(() => undefined);
    },
  };
}

// A list page bound to the address: its search, its filters and the cursor
// trail are URL parameters, so a reload or a shared link shows the same page.
export function useResourceList<T>({
  tenant,
  resource,
  search = [],
  filters = [],
  fixed = {},
  defaults = {},
  read,
  count,
}: {
  tenant: string;
  // Names the list in the query cache, e.g. `clients`.
  resource: string;
  // The fields a search can apply to, the default first.
  search?: readonly string[];
  // The exact filters the list takes, each a URL parameter of that name.
  filters?: readonly string[];
  // Parameters every read carries, such as an Activity tab's record.
  fixed?: Readonly<Record<string, string>>;
  // What a filter the address does not set reads as, without counting as narrowing.
  defaults?: Readonly<Record<string, string>>;
  read: ReadPage<T>;
  count?: ReadCount;
}): ResourceListState<T> {
  const { gateway } = useTransport();
  const { invalidate } = useInvalidate();
  const { params, go } = useUrlSearch();
  const spec = { fields: search, filters };
  const narrowing = listFromSearch(params, spec);
  const trail = trailFromSearch(params);
  const query = apiQuery(withDefaults(narrowing, defaults), fixed);
  const key = listKey(tenant, resource);
  const pages = useListPages({ key, query, cursor: currentCursor(trail), read });
  const counted = useQuery({
    queryKey: countKey(tenant, resource, query.toString()),
    enabled: count !== undefined,
    queryFn: () =>
      count === undefined ? Promise.resolve(null) : count(gateway, new URLSearchParams(query)),
  });
  const narrow = (next: ListNarrowing): void => {
    go(listToSearch(params, next, spec));
  };
  return {
    ...narrowing,
    status: pages.status,
    rows: pages.rows,
    count: countOf(counted.data),
    narrowed: isNarrowed(narrowing),
    trail,
    next: pages.next,
    loadingMore: pages.loadingMore,
    loadLimited: pages.loadLimited,
    loadMoreFailed: pages.loadMoreFailed,
    setSearch: (next) => {
      narrow({ search: next, filters: narrowing.filters });
    },
    setFilter: (name, value) => {
      narrow(withFilter(narrowing, name, value));
    },
    clear: () => {
      narrow({ search: null, filters: {} });
    },
    setTrail: (next) => {
      go(trailToSearch(next, params));
    },
    loadMore: pages.loadMore,
    retry: () => {
      pages.retry();
      invalidate(countKey(tenant, resource));
    },
  };
}
