import { describe, expect, it } from 'vitest';
import { isRecord, parseJson } from '#/shared/lib/services/json';

describe('parseJson', () => {
  it('returns the parsed value', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for text that is not JSON', () => {
    expect(parseJson('<html>')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });
});

describe('isRecord', () => {
  it('is true for a plain object only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('a')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});
