import { expect, it } from 'vitest';
import { apiQuery, listFromSearch, listToSearch } from '#/shared/service/resourceList.ts';

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
