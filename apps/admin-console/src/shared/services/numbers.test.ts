import { describe, expect, it } from 'vitest';
import { numberKept, rangeSentence } from '#/shared/services/numbers';

describe('numberKept', () => {
  it('takes what was entered, and keeps what was there when the field was cleared', () => {
    expect(numberKept(900, 600)).toBe(900);
    expect(numberKept(0, 600)).toBe(0);
    expect(numberKept(Number.NaN, 600)).toBe(600);
  });
});

describe('rangeSentence', () => {
  it('words a range with both ends, and one with no top as at least', () => {
    expect(rangeSentence(8, 256)).toBe('Between 8 and 256.');
    expect(rangeSentence(1, undefined)).toBe('At least 1.');
  });

  it('shows each end as given, and puts a unit after the last', () => {
    expect(rangeSentence(60, 90, (n) => `${String(n)} s`)).toBe('Between 60 s and 90 s.');
    expect(rangeSentence(8, 256, String, ' characters')).toBe('Between 8 and 256 characters.');
    expect(rangeSentence(0, undefined, String, ' clients')).toBe('At least 0 clients.');
  });
});
