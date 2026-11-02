import type { CountResponse } from '@odudu/contracts/admin';
import type { CursorTrail } from '#/shared/services/cursorTrail';
import { isRefused, isStaleCursor } from '#/shared/services/failure';
import { readFailureOf } from '#/shared/services/readFailure';
import type { GatewayFailure, GatewayResult } from '#/shared/services/result';

// A prefix of one named field, as the admin API searches.
export interface ListSearch {
  field: string;
  query: string;
}

export interface ListNarrowing {
  search: ListSearch | null;
  filters: Readonly<Record<string, string>>;
}

export interface ListSpec {
  // The fields a search can apply to, the default first; empty for none.
  fields: readonly string[];
  filters: readonly string[];
}

export interface ListPage<T> {
  items: readonly T[];
  next?: string | undefined;
}

export type ListStatus = 'loading' | 'failed' | 'refused' | 'ready';

// A list page's whole state, as the view renders it.
export interface ResourceListState<T> extends ListNarrowing {
  status: ListStatus;
  rows: readonly T[];
  count: CountResponse | null;
  narrowed: boolean;
  trail: CursorTrail;
  next: string | null;
  loadingMore: boolean;
  // More rows exist, but "Load more" has reached the row budget.
  loadLimited: boolean;
  // A page after the first failed; the rows already shown stay.
  loadMoreFailed: boolean;
  setSearch: (search: ListSearch) => void;
  setFilter: (name: string, value: string | null) => void;
  clear: () => void;
  setTrail: (trail: CursorTrail) => void;
  loadMore: () => void;
  retry: () => void;
}

const QUERY = 'q';
const FIELD = 'by';
const TRAIL = 'after';

export function listFromSearch(params: URLSearchParams, spec: ListSpec): ListNarrowing {
  const query = params.get(QUERY) ?? '';
  const asked = params.get(FIELD);
  const field = spec.fields.find((name) => name === asked) ?? spec.fields[0];
  const filters = Object.fromEntries(
    spec.filters.flatMap((name) => {
      const value = params.get(name);
      return value === null || value === '' ? [] : [[name, value]];
    }),
  );
  return {
    search: field === undefined || query === '' ? null : { field, query },
    filters,
  };
}

// A cursor is bound to the filters it was issued under, so any change to
// them drops the trail and the list starts again from its first page.
export function listToSearch(
  base: URLSearchParams,
  narrowing: ListNarrowing,
  spec: ListSpec,
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const name of [QUERY, FIELD, TRAIL, ...spec.filters]) params.delete(name);
  const { search } = narrowing;
  if (search !== null && search.query !== '') {
    params.set(QUERY, search.query);
    if (search.field !== spec.fields[0]) params.set(FIELD, search.field);
  }
  for (const [name, value] of Object.entries(narrowing.filters)) {
    if (spec.filters.includes(name) && value !== '') params.set(name, value);
  }
  return params;
}

export function apiQuery(
  narrowing: ListNarrowing,
  fixed: Readonly<Record<string, string>> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (narrowing.search !== null) params.set(narrowing.search.field, narrowing.search.query);
  for (const [name, value] of Object.entries({ ...narrowing.filters, ...fixed })) {
    params.set(name, value);
  }
  return params;
}

export function listStatusOf(failure: GatewayFailure | null): ListStatus {
  if (failure === null) return 'ready';
  return isRefused(failure) ? 'refused' : 'failed';
}

export function isNarrowed(narrowing: ListNarrowing): boolean {
  return narrowing.search !== null || Object.keys(narrowing.filters).length > 0;
}

export function withFilter(
  narrowing: ListNarrowing,
  name: string,
  value: string | null,
): ListNarrowing {
  const others = Object.entries(narrowing.filters).filter(([filter]) => filter !== name);
  return {
    search: narrowing.search,
    filters: Object.fromEntries(value === null ? others : [...others, [name, value]]),
  };
}

// What a filter the address does not set reads as, without narrowing.
export function withDefaults(
  narrowing: ListNarrowing,
  defaults: Readonly<Record<string, string>>,
): ListNarrowing {
  return { ...narrowing, filters: { ...defaults, ...narrowing.filters } };
}

export interface PagesState<T> {
  status: ListStatus;
  rows: readonly T[];
  next: string | null;
}

// The pages read so far, or the failure of the first. A page after the
// first that failed leaves the rows already read as they are.
export function listPagesState<T>(
  data: { pages: readonly ListPage<T>[] } | undefined,
  error: unknown,
): PagesState<T> {
  const pages = data?.pages ?? [];
  const failure = data === undefined ? readFailureOf(error) : null;
  return {
    status: data === undefined && failure === null ? 'loading' : listStatusOf(failure),
    rows: pages.flatMap((page) => page.items),
    next: pages.at(-1)?.next ?? null,
  };
}

// What stopped the first page, when it is what failed.
export function firstPageFailureOf(
  data: { pages: readonly unknown[] } | undefined,
  error: unknown,
): GatewayFailure | null {
  return data === undefined ? readFailureOf(error) : null;
}

// The first page failed because the cursor it was asked from is no longer one.
export function staleCursorOf(
  data: { pages: readonly unknown[] } | undefined,
  error: unknown,
): boolean {
  return isStaleCursor(firstPageFailureOf(data, error));
}

// About how many rows "Load more" appends to one list: the check runs before
// each page, so a list can end up to one page over. Past it the list says to
// narrow it instead.
export const ROW_BUDGET = 1_000;

export const LOAD_LIMIT_NOTICE = 'This is as far as the list can load. Narrow it to see further.';

export function rowBudgetReached(rowCount: number): boolean {
  return rowCount >= ROW_BUDGET;
}

export function loadLimited(hasNextPage: boolean, rowCount: number): boolean {
  return hasNextPage && rowBudgetReached(rowCount);
}

export function canLoadMore(hasNextPage: boolean, isFetching: boolean, rowCount: number): boolean {
  return hasNextPage && !isFetching && !rowBudgetReached(rowCount);
}

export function moreFailed(hasRows: boolean, nextPageFailed: boolean): boolean {
  return hasRows && nextPageFailed;
}

// `null` is a count that is not asked for.
export function countOf(
  answer: GatewayResult<CountResponse> | null | undefined,
): CountResponse | null {
  return answer?.ok === true ? answer.data : null;
}
