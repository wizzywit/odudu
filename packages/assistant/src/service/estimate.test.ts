import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inputUpperBound } from '#/service/estimate';

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

describe('inputUpperBound', () => {
  it('is the byte length of the serialised request', () => {
    expect(inputUpperBound('abc')).toBe(3);
    expect(inputUpperBound('日本')).toBe(6);
    expect(inputUpperBound('')).toBe(0);
  });

  it('takes the provider count when it is the larger', () => {
    expect(inputUpperBound('abc', 100)).toBe(100);
    expect(inputUpperBound('abc', 1)).toBe(3);
  });

  it('ignores a provider count that is not a usable number', () => {
    expect(inputUpperBound('abc', Number.NaN)).toBe(3);
    expect(inputUpperBound('abc', -5)).toBe(3);
  });

  it('never returns less than the byte length', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }),
        fc.option(fc.nat(), { nil: undefined }),
        (text, count) => {
          expect(inputUpperBound(text, count)).toBeGreaterThanOrEqual(byteLength(text));
          if (count !== undefined) {
            expect(inputUpperBound(text, count)).toBeGreaterThanOrEqual(count);
          }
        },
      ),
    );
  });
});
