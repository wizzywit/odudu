import { describe, expect, it } from 'vitest';
import { revealOffset } from '#/shared/service/reveal';

// A row 300 wide, scrolled 100 along, whose items are measured from the screen.
const VIEW = { start: 0, size: 300, scrolled: 100 };

describe('revealOffset', () => {
  it('leaves a row alone when the item is whole in view', () => {
    expect(revealOffset({ start: 50, size: 100 }, VIEW)).toBeNull();
  });

  it('scrolls back to an item cut off at the start, leaving a margin', () => {
    expect(revealOffset({ start: -40, size: 100 }, VIEW)).toBe(100 - 40 - 24);
  });

  it('never scrolls before the start of the row', () => {
    expect(revealOffset({ start: -400, size: 100 }, VIEW)).toBe(0);
  });

  it('scrolls on to an item cut off at the end, leaving a margin', () => {
    expect(revealOffset({ start: 250, size: 100 }, VIEW)).toBe(100 + 250 + 100 + 24 - 300);
  });
});
