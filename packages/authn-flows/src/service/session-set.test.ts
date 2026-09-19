import { describe, expect, it } from 'vitest';
import { chooseEvictions } from '#/service/session-set';

function at(id: string, iso: string) {
  return { id, lastActiveAt: new Date(iso) };
}

describe('chooseEvictions', () => {
  it('evicts nothing below the cap', () => {
    expect(chooseEvictions([at('a', '2026-09-19T10:00:00Z')], 3)).toEqual([]);
  });

  it('evicts the least recently active so that admitting one more fits', () => {
    const live = [
      at('a', '2026-09-19T10:00:00Z'),
      at('b', '2026-09-19T09:00:00Z'),
      at('c', '2026-09-19T11:00:00Z'),
    ];
    expect(chooseEvictions(live, 3)).toEqual(['b']);
  });

  it('evicts enough to fit when the browser is already over the cap', () => {
    const live = [
      at('a', '2026-09-19T10:00:00Z'),
      at('b', '2026-09-19T09:00:00Z'),
      at('c', '2026-09-19T11:00:00Z'),
      at('d', '2026-09-19T08:00:00Z'),
    ];
    expect(chooseEvictions(live, 2)).toEqual(['d', 'b', 'a']);
  });
});
