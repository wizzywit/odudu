import { describe, expect, it } from 'vitest';
import { narrowOptions } from '#/shared/service/options';

const OPTIONS = [
  { id: 'a.title', label: 'a.title', detail: 'Sign in' },
  { id: 'b.title', label: 'b.title', detail: 'Account' },
  { id: 'a.body', label: 'a.body', detail: 'Enter your TITLE here' },
  { id: 'c.other', label: 'c.other' },
];

describe('narrowOptions', () => {
  it('keeps the first `limit` options when nothing is typed', () => {
    expect(narrowOptions(OPTIONS, '', 2).map((o) => o.id)).toEqual(['a.title', 'b.title']);
    expect(narrowOptions(OPTIONS, '   ', 3)).toHaveLength(3);
  });

  it('matches the label or the detail, ignoring case, and puts label prefixes first', () => {
    expect(narrowOptions(OPTIONS, 'title', 10).map((o) => o.id)).toEqual([
      'a.title',
      'b.title',
      'a.body',
    ]);
    expect(narrowOptions(OPTIONS, 'b.', 10).map((o) => o.id)).toEqual(['b.title']);
    expect(narrowOptions(OPTIONS, 'ACCOUNT', 10).map((o) => o.id)).toEqual(['b.title']);
  });

  it('ranks a label that starts with the text before one that only contains it', () => {
    const list = [
      { id: 'x.title', label: 'x.title' },
      { id: 'title.y', label: 'title.y' },
    ];
    expect(narrowOptions(list, 'title', 5).map((o) => o.id)).toEqual(['title.y', 'x.title']);
  });

  it('never returns more than the limit, however many match, and is empty for no match', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      id: `k${String(i)}`,
      label: `k${String(i)}`,
    }));
    expect(narrowOptions(many, 'k', 50)).toHaveLength(50);
    expect(narrowOptions(many, 'zzz', 50)).toEqual([]);
    expect(narrowOptions(many, 'k', 0)).toEqual([]);
  });
});
