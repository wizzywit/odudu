import { describe, expect, it } from 'vitest';
import { inOrderOf } from '#/service/in-order';

describe('inOrderOf', () => {
  it('returns the rows in the order of the keys, whatever order they were read in', () => {
    const rows = [
      { id: 'b', n: 2 },
      { id: 'c', n: 3 },
      { id: 'a', n: 1 },
    ];
    expect(inOrderOf(['a', 'b', 'c'], rows, (row) => row.id)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'c', n: 3 },
    ]);
  });

  it('leaves out a key whose row is gone', () => {
    expect(inOrderOf(['a', 'x'], [{ id: 'a' }], (row) => row.id)).toEqual([{ id: 'a' }]);
  });

  it('is empty for no keys', () => {
    expect(inOrderOf([], [{ id: 'a' }], (row) => row.id)).toEqual([]);
  });
});
