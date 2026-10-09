import { describe, expect, it } from 'vitest';
import { inOrderOf, readKeyedPage } from '#/service/in-order';

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

describe('readKeyedPage', () => {
  it('reads again when a row vanished between the keys and the rows, so the page stays full', async () => {
    const keys = [
      ['a', 'b', 'c'],
      ['a', 'c', 'd'],
    ];
    let read = 0;
    const page = await readKeyedPage(
      () => Promise.resolve(keys[read++] ?? []),
      // `b` is deleted after the first keys were read.
      (ids) => Promise.resolve(ids.filter((id) => id !== 'b').map((id) => ({ id }))),
      (row) => row.id,
    );
    expect(page.map((row) => row.id)).toEqual(['a', 'c', 'd']);
    expect(read).toBe(2);
  });

  it('reads once when nothing vanished, and not at all for no keys', async () => {
    let reads = 0;
    const page = await readKeyedPage(
      () => {
        reads += 1;
        return Promise.resolve(['a']);
      },
      (ids) => Promise.resolve(ids.map((id) => ({ id }))),
      (row) => row.id,
    );
    expect(page).toEqual([{ id: 'a' }]);
    expect(reads).toBe(1);
    expect(
      await readKeyedPage(
        () => Promise.resolve([]),
        () => Promise.reject(new Error('read')),
        (r: { id: string }) => r.id,
      ),
    ).toEqual([]);
  });
});
