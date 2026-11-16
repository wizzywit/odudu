import { describe, expect, it } from 'vitest';
import { numberKept, outsideRange, rangeSentence } from '#/shared/lib/services/numbers';

describe('numberKept', () => {
  it('takes what was entered, and keeps what was there when the field was cleared', () => {
    expect(numberKept(900, 600)).toBe(900);
    expect(numberKept(0, 600)).toBe(0);
    expect(numberKept(Number.NaN, 600)).toBe(600);
  });
});

describe('rangeSentence', () => {
  it('words a range with both ends, and one with no top as at least', () => {
    expect(rangeSentence(8, 256)).toBe('Allowed: 8 to 256.');
    expect(rangeSentence(1, undefined)).toBe('Allowed: at least 1.');
  });

  it('shows each end as given, and puts a unit after the last', () => {
    expect(rangeSentence(60, 90, (n) => `${String(n)} s`)).toBe('Allowed: 60 s to 90 s.');
    expect(rangeSentence(8, 256, String, ' characters')).toBe('Allowed: 8 to 256 characters.');
    expect(rangeSentence(0, undefined, String, ' clients')).toBe('Allowed: at least 0 clients.');
  });
});

describe('outsideRange', () => {
  it('is true beyond either end, and false inside or for a value not entered', () => {
    expect(outsideRange(30, 60, 90)).toBe(true);
    expect(outsideRange(100, 60, 90)).toBe(true);
    expect(outsideRange(60, 60, undefined)).toBe(false);
    expect(outsideRange(Number.NaN, 60, 90)).toBe(false);
  });
});
