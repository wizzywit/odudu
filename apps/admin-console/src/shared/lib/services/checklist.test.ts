import { describe, expect, it } from 'vitest';
import { headedRuns, isCompact } from '#/shared/lib/services/checklist';

describe('headedRuns', () => {
  it('gathers neighbouring options of one group and keeps the order', () => {
    const options: { id: string; group?: string }[] = [
      { id: 'a', group: 'Name' },
      { id: 'b', group: 'Name' },
      { id: 'c', group: 'Address' },
      { id: 'd', group: 'Name' },
    ];
    const runs = headedRuns(options);
    expect(runs.map((run) => [run.title, run.options.map((o) => o.id)])).toEqual([
      ['Name', ['a', 'b']],
      ['Address', ['c']],
      ['Name', ['d']],
    ]);
  });

  it('makes one untitled run of options with no group', () => {
    const plain: { id: string; group?: string }[] = [{ id: 'a' }, { id: 'b' }];
    expect(headedRuns(plain).map((run) => run.title)).toEqual([undefined]);
  });
});

describe('isCompact', () => {
  it('is true while no option carries text of its own', () => {
    expect(isCompact([{}, { description: '' }, { note: null }])).toBe(true);
    expect(isCompact([{}, { description: 'Asks for it.' }])).toBe(false);
    expect(isCompact([{ unavailable: 'Always recorded.' }])).toBe(false);
  });
});
