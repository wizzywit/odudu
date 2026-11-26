import { describe, expect, it } from 'vitest';
import { createLedger } from '#/service/trace-ledger';
import { TURN_BYTES, TURN_EVENTS } from '#/service/trace-payload';

describe('createLedger', () => {
  it('numbers the events it admits from zero', () => {
    const ledger = createLedger();
    expect([ledger.admit(10), ledger.admit(10), ledger.admit(10)]).toEqual([0, 1, 2]);
    expect(ledger.dropped()).toBe(0);
  });

  it('keeps one place for the note that others were left out', () => {
    const ledger = createLedger();
    for (let i = 0; i < TURN_EVENTS - 1; i += 1) expect(ledger.admit(1)).toBe(i);
    expect(ledger.admit(1)).toBeUndefined();
    expect(ledger.admit(1)).toBeUndefined();
    expect(ledger.dropped()).toBe(2);
    expect(ledger.closingSeq()).toBe(TURN_EVENTS - 1);
  });

  it('refuses an event that would take the turn past its bytes, and counts it', () => {
    const ledger = createLedger();
    expect(ledger.admit(TURN_BYTES - 10)).toBe(0);
    expect(ledger.admit(11)).toBeUndefined();
    expect(ledger.admit(10)).toBe(1);
    expect(ledger.dropped()).toBe(1);
  });
});
