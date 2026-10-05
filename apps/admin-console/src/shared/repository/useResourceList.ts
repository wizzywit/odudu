import type { CountResponse } from '@odudu/contracts/admin';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { currentCursor, trailFromSearch, trailToSearch } from '#/shared/service/cursorTrail.ts';
import {
  apiQuery,
  listFromSearch,
  listToSearch,
  type ListNarrowing,
  type ListPage,
  type ListStatus,
  type ResourceListState,
} from '#/shared/service/resourceList.ts';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export type ReadPage<T> = (
  gateway: Gateway,
  query: URLSearchParams,
) => Promise<GatewayResult<ListPage<T>>>;
export type ReadCount = (
  gateway: Gateway,
  query: URLSearchParams,
) => Promise<GatewayResult<CountResponse>>;

// Thrown so that a failed page leaves the pages before it in place.
class PageFailure extends Error {
  readonly failure: GatewayFailure;
  constructor(failure: GatewayFailure) {
    super('a list page could not be read');
    this.failure = failure;
  }
}

function statusOf(failure: GatewayFailure | null): ListStatus {
  if (failure === null) return 'ready';
  return failure.kind === 'problem' && failure.problem.status === 403 ? 'refused' : 'failed';
}

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
    queryKey: [...key, query.toString(), cursor ?? ''],
    initialPageParam: cursor,
    enabled,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam !== undefined) params.set('cursor', pageParam);
      const result = await read(gateway, params);
      if (!result.ok) throw new PageFailure(result);
      return result.data;
    },
    getNextPageParam: (last: ListPage<T>) => last.next,
  });
  const loaded = pages.data?.pages ?? [];
  const failure =
    pages.data === undefined && pages.error instanceof PageFailure ? pages.error.failure : null;
  return {
    status: pages.data === undefined && failure === null ? ('loading' as const) : statusOf(failure),
    rows: loaded.flatMap((page) => page.items),
    next: loaded.at(-1)?.next ?? null,
    loadingMore: pages.isFetchingNextPage,
    loadMoreFailed: pages.data !== undefined && pages.isFetchNextPageError,
    loadMore: () => {
      if (pages.hasNextPage && !pages.isFetching) pages.fetchNextPage().catch(() => undefined);
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
  const client = useQueryClient();
  const { params, go } = useUrlSearch();
  const spec = { fields: search, filters };
  const narrowing = listFromSearch(params, spec);
  const trail = trailFromSearch(params);
  const query = apiQuery({ ...narrowing, filters: { ...defaults, ...narrowing.filters } }, fixed);
  const key = ['list', tenant, resource] as const;
  const pages = useListPages({ key, query, cursor: currentCursor(trail), read });
  const counted = useQuery({
    queryKey: ['count', tenant, resource, query.toString()],
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
    count: counted.data?.ok === true ? counted.data.data : null,
    narrowed: narrowing.search !== null || Object.keys(narrowing.filters).length > 0,
    trail,
    next: pages.next,
    loadingMore: pages.loadingMore,
    loadMoreFailed: pages.loadMoreFailed,
    setSearch: (next) => {
      narrow({ search: next, filters: narrowing.filters });
    },
    setFilter: (name, value) => {
      const others = Object.entries(narrowing.filters).filter(([filter]) => filter !== name);
      narrow({
        search: narrowing.search,
        filters: Object.fromEntries(value === null ? others : [...others, [name, value]]),
      });
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
      client.invalidateQueries({ queryKey: ['count', tenant, resource] }).catch(() => undefined);
    },
  };
}
