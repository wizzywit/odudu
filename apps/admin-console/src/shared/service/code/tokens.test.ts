import { describe, expect, it } from 'vitest';
import { scanUntil, scanWhile } from '#/shared/service/code/tokens';

describe('scanning', () => {
  it('stops at the first character the test accepts, or the end', () => {
    expect(scanUntil('ab;cd', 0, (code) => code === 0x3b)).toBe(2);
    expect(scanUntil('abcd', 1, () => false)).toBe(4);
  });

  it('tells the stop test where it is looking', () => {
    expect(scanUntil('abcd', 0, (_, index) => index === 3)).toBe(3);
  });

  it('runs on while the test accepts', () => {
    expect(scanWhile('  x', 0, (code) => code === 0x20)).toBe(2);
    expect(scanWhile('  x', 2, (code) => code === 0x20)).toBe(2);
    expect(scanWhile('   ', 0, (code) => code === 0x20)).toBe(3);
  });
});
