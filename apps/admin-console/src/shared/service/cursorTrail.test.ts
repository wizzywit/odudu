import { describe, expect, it } from 'vitest';
import {
  advance,
  currentCursor,
  retreat,
  trailFromSearch,
  trailToSearch,
} from '#/shared/service/cursorTrail.ts';

it('starts on the first page, which has no cursor', () => {
  expect(currentCursor([])).toBeUndefined();
});

it('walks forward by appending the cursor it was given and back by dropping it', () => {
  const second = advance([], 'c-2');
  const third = advance(second, 'c-3');
  expect(third).toEqual(['c-2', 'c-3']);
  expect(currentCursor(third)).toBe('c-3');
  expect(retreat(third)).toEqual(['c-2']);
  expect(currentCursor(retreat(retreat(third)))).toBeUndefined();
});

it('stays on the first page when asked to go back from it', () => {
  expect(retreat([])).toEqual([]);
});

it('never changes the trail it was given', () => {
  const trail = Object.freeze(['c-2']);
  expect(advance(trail, 'c-3')).toEqual(['c-2', 'c-3']);
  expect(retreat(trail)).toEqual([]);
  expect(trail).toEqual(['c-2']);
});

describe('the trail in the URL', () => {
  const C2 = 'eyJhZnRlciI6IjAxOTIifQ.q7Hn2vX0pR-4tKe9WmZ3cY8bLs1uD6fA';
  const C3 = 'eyJhZnRlciI6IjAxOTMifQ.Zm9vYmFyLWJhei1xdXV4LTAxMjM0NTY3';

  it('is one repeated after= parameter per page, oldest first', () => {
    expect(trailToSearch([C2, C3]).toString()).toBe(`after=${C2}&after=${C3}`);
    expect(trailFromSearch(`?after=${C2}&after=${C3}`)).toEqual([C2, C3]);
  });

  it('round-trips, keeping every other parameter', () => {
    const search = trailToSearch([C2, C3], new URLSearchParams('username=ada&after=stale.x'));
    expect(search.getAll('username')).toEqual(['ada']);
    expect(trailFromSearch(search)).toEqual([C2, C3]);
    expect(trailToSearch([], search).has('after')).toBe(false);
  });

  it('reads no trail as the first page', () => {
    expect(trailFromSearch('')).toEqual([]);
    expect(trailFromSearch('?username=ada')).toEqual([]);
  });

  it('refuses a whole trail with any entry that is not a cursor', () => {
    for (const bad of ['', 'no-dot', 'a.b.c', 'has space.x', 'a.b/c', `${'a'.repeat(2048)}.b`]) {
      const search = new URLSearchParams([
        ['after', C2],
        ['after', bad],
      ]);
      expect(trailFromSearch(search), bad).toEqual([]);
    }
  });

  it('refuses a trail longer than anybody pages by hand', () => {
    const long = new URLSearchParams(Array.from({ length: 101 }, () => ['after', C2]));
    expect(trailFromSearch(long)).toEqual([]);
  });
});
