import { expect, it } from 'vitest';
import { advance, currentCursor, retreat } from '#/shared/service/cursorTrail.ts';

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
