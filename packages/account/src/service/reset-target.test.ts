import { describe, expect, it } from 'vitest';
import { resetTarget } from '#/service/reset-target';

describe('resetTarget', () => {
  it('skips an unverified address where the tenant asks for proof', () => {
    expect(resetTarget({ verified: false, requireVerified: true })).toBe('skip');
  });

  it.each([
    [false, false],
    [true, true],
    [true, false],
  ])('sends when verified is %s and proof required is %s', (verified, requireVerified) => {
    expect(resetTarget({ verified, requireVerified })).toBe('send');
  });
});
