import { describe, expect, it } from 'vitest';
import { inOrderOf, removedFrom, sortedIds, uniqueIds } from '#/shared/service/ids.ts';

describe('sortedIds', () => {
  it('sorts a copy and leaves the input alone', () => {
    const ids = ['b', 'a', 'c'];
    expect(sortedIds(ids)).toEqual(['a', 'b', 'c']);
    expect(ids).toEqual(['b', 'a', 'c']);
  });
});

describe('inOrderOf', () => {
  it("keeps the chosen ones that are in the order, in the order's sequence", () => {
    expect(inOrderOf(['x', 'y', 'z'] as const, new Set(['z', 'x', 'q']))).toEqual(['x', 'z']);
    expect(inOrderOf(['x', 'y'] as const, [])).toEqual([]);
  });
});

describe('removedFrom', () => {
  it('lists what was there before and is not there after', () => {
    expect(removedFrom(['a', 'b', 'c'], ['b', 'd'])).toEqual(['a', 'c']);
    expect(removedFrom([], ['a'])).toEqual([]);
  });
});

describe('uniqueIds', () => {
  it('keeps the first of each, in order', () => {
    expect(uniqueIds(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});
