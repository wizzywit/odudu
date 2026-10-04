import type { CountResponse } from '@odudu/contracts/admin';
import type { CursorTrail } from '#/shared/service/cursorTrail.ts';

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
