import { describe, expect, it } from 'vitest';
import { ReadFailure } from '#/shared/services/readFailure';
import {
  apiQuery,
  canLoadMore,
  countOf,
  isNarrowed,
  listFromSearch,
  listStatusOf,
  listPagesState,
  loadLimited,
  staleCursorOf,
  firstPageFailureOf,
  listToSearch,
  moreFailed,
  ROW_BUDGET,
  rowBudgetReached,
  withDefaults,
  withFilter,
} from '#/shared/services/resourceList';

const SPEC = { fields: ['username', 'email'], filters: ['enabled', 'role'] } as const;

it('reads the search, the field it applies to and the filters from the address', () => {
  expect(
    listFromSearch(new URLSearchParams('q=ad&by=email&enabled=true&tab=x&after=a.b'), SPEC),
  ).toEqual({ search: { field: 'email', query: 'ad' }, filters: { enabled: 'true' } });
});

it('searches the first field when the address names none, and ignores one it does not know', () => {
  expect(listFromSearch(new URLSearchParams('q=ad'), SPEC).search).toEqual({
    field: 'username',
    query: 'ad',
  });
  expect(listFromSearch(new URLSearchParams('q=ad&by=password'), SPEC).search).toEqual({
    field: 'username',
    query: 'ad',
  });
});

it('reads no search from a list that has none, or from an empty one', () => {
  expect(
    listFromSearch(new URLSearchParams('q=ad'), { fields: [], filters: [] }).search,
  ).toBeNull();
  expect(listFromSearch(new URLSearchParams('q='), SPEC).search).toBeNull();
});

it('writes a narrowing that starts the list again from its first page', () => {
  const was = new URLSearchParams('q=ad&after=a.b&after=c.d&tab=activity&enabled=false');
  expect(
    listToSearch(
      was,
      { search: { field: 'email', query: 'gr' }, filters: { enabled: 'true', role: 'r1' } },
      SPEC,
    ).toString(),
  ).toBe('tab=activity&q=gr&by=email&enabled=true&role=r1');
  expect(
    listToSearch(was, { search: { field: 'username', query: '' }, filters: {} }, SPEC).toString(),
  ).toBe('tab=activity');
});

it('asks the API for the search as a prefix of its field, with the filters and fixed values', () => {
  expect(
    apiQuery(
      { search: { field: 'email', query: 'gr' }, filters: { enabled: 'true' } },
      { resource_type: 'client' },
    ).toString(),
  ).toBe('email=gr&enabled=true&resource_type=client');
});

describe('listStatusOf', () => {
  it('is ready without a failure, refused for a 403 and failed for anything else', () => {
    expect(listStatusOf(null)).toBe('ready');
    expect(
      listStatusOf({
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
      }),
    ).toBe('refused');
    expect(
      listStatusOf({
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Boom', status: 500 },
      }),
    ).toBe('failed');
    expect(listStatusOf({ ok: false, kind: 'network' })).toBe('failed');
  });
});

describe('isNarrowed and withFilter', () => {
  it('is narrowed by a search or any filter', () => {
    expect(isNarrowed({ search: null, filters: {} })).toBe(false);
    expect(isNarrowed({ search: { field: 'name', query: 'a' }, filters: {} })).toBe(true);
    expect(isNarrowed({ search: null, filters: { enabled: 'true' } })).toBe(true);
  });
  it('sets one filter, replaces it, and drops it for null', () => {
    const was = { search: null, filters: { enabled: 'true', kind: 'x' } };
    expect(withFilter(was, 'enabled', 'false').filters).toEqual({ kind: 'x', enabled: 'false' });
    expect(withFilter(was, 'enabled', null).filters).toEqual({ kind: 'x' });
    expect(withFilter(was, 'other', 'v').search).toBeNull();
  });
});

describe('listPagesState', () => {
  const pages = {
    pages: [
      { items: ['a', 'b'], next: 'c1' },
      { items: ['c'], next: 'c2' },
    ],
  };
  const refused = {
    ok: false as const,
    kind: 'problem' as const,
    problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
  };

  it('is loading until a page or a failure arrives', () => {
    expect(listPagesState(undefined, null)).toEqual({ status: 'loading', rows: [], next: null });
    expect(listPagesState(undefined, new Error('boom')).status).toBe('loading');
  });
  it("joins the rows of every page and points at the last page's next", () => {
    expect(listPagesState(pages, null)).toEqual({
      status: 'ready',
      rows: ['a', 'b', 'c'],
      next: 'c2',
    });
    expect(listPagesState({ pages: [{ items: ['a'] }] }, null).next).toBeNull();
    expect(listPagesState({ pages: [] }, null)).toEqual({ status: 'ready', rows: [], next: null });
  });
  it('fails or is refused only when the first page failed', () => {
    expect(listPagesState(undefined, new ReadFailure(refused)).status).toBe('refused');
    expect(listPagesState(undefined, new ReadFailure({ ok: false, kind: 'network' })).status).toBe(
      'failed',
    );
    expect(listPagesState(pages, new ReadFailure(refused)).status).toBe('ready');
  });
});

describe('what a list does while paging', () => {
  it('loads more only when a page follows and nothing is being read', () => {
    expect(canLoadMore(true, false, 50)).toBe(true);
    expect(canLoadMore(false, false, 50)).toBe(false);
    expect(canLoadMore(true, true, 50)).toBe(false);
  });
  it('says the list is limited only while rows remain beyond the budget', () => {
    expect(loadLimited(true, ROW_BUDGET)).toBe(true);
    expect(loadLimited(true, ROW_BUDGET - 1)).toBe(false);
    expect(loadLimited(false, ROW_BUDGET)).toBe(false);
  });
  it('stops appending once the row budget is read, and says the budget is reached', () => {
    expect(rowBudgetReached(ROW_BUDGET - 1)).toBe(false);
    expect(rowBudgetReached(ROW_BUDGET)).toBe(true);
    expect(canLoadMore(true, false, ROW_BUDGET - 1)).toBe(true);
    expect(canLoadMore(true, false, ROW_BUDGET)).toBe(false);
  });
  it('says a later page failed only while the rows already read are shown', () => {
    expect(moreFailed(true, true)).toBe(true);
    expect(moreFailed(false, true)).toBe(false);
    expect(moreFailed(true, false)).toBe(false);
  });
});

describe('withDefaults and countOf', () => {
  it('reads an unset filter as its default, which the address overrides', () => {
    const narrowing = { search: null, filters: { enabled: 'false' } };
    expect(withDefaults(narrowing, { enabled: 'true', kind: 'x' })).toEqual({
      search: null,
      filters: { enabled: 'false', kind: 'x' },
    });
    expect(withDefaults(narrowing, {}).filters).toEqual({ enabled: 'false' });
  });
  it('takes the count off a successful answer, and none off anything else', () => {
    const counted = { count: 4, capped: false };
    expect(countOf({ ok: true, status: 200, data: counted, etag: null, next: null })).toBe(counted);
    expect(countOf({ ok: false, kind: 'network' })).toBeNull();
    expect(countOf(undefined)).toBeNull();
    expect(countOf(null)).toBeNull();
  });
});

describe('staleCursorOf', () => {
  const stale = new ReadFailure({
    ok: false,
    kind: 'problem',
    problem: {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'cursor', message: 'is invalid or expired' }],
    },
  });

  it('is true only while the first page is what failed, with a stale cursor', () => {
    expect(staleCursorOf(undefined, stale)).toBe(true);
    expect(staleCursorOf({ pages: [{ items: [] }] }, stale)).toBe(false);
    expect(staleCursorOf(undefined, new ReadFailure({ ok: false, kind: 'network' }))).toBe(false);
    expect(staleCursorOf(undefined, null)).toBe(false);
  });
});

describe('firstPageFailureOf', () => {
  it('is what stopped the first page, and nothing once a page has been read', () => {
    const failure = { ok: false, kind: 'network' } as const;
    expect(firstPageFailureOf(undefined, new ReadFailure(failure))).toEqual(failure);
    expect(firstPageFailureOf({ pages: [{ items: [] }] }, new ReadFailure(failure))).toBeNull();
    expect(firstPageFailureOf(undefined, new Error('boom'))).toBeNull();
  });
});
