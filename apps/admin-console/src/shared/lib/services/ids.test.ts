import { describe, expect, it } from 'vitest';
import { indexById, inOrderOf, removedFrom, sortedIds, uniqueIds } from '#/shared/lib/services/ids';

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

describe('indexById', () => {
  it('finds each item by its id, a later list winning over an earlier one', () => {
    const first = { id: 'a', name: 'old' };
    const later = { id: 'a', name: 'new' };
    const other = { id: 'b', name: 'b' };
    const index = indexById([first, other], [later]);
    expect(index.get('a')).toBe(later);
    expect(index.get('b')).toBe(other);
    expect(index.get('c')).toBeUndefined();
    expect(indexById().size).toBe(0);
  });
});
