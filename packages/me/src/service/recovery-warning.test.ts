import { describe, expect, it } from 'vitest';
import { recoveryCodesLow, recoveryWarning } from '#/service/recovery-warning';

describe('recoveryWarning', () => {
  it('warns when fewer codes remain than the threshold', () => {
    expect(recoveryWarning(2, 3)).toBe(true);
    expect(recoveryWarning(0, 3)).toBe(true);
  });

  it('does not warn at the threshold or above it', () => {
    expect(recoveryWarning(3, 3)).toBe(false);
    expect(recoveryWarning(10, 3)).toBe(false);
  });

  it('is off at a threshold of 0, even with every code spent', () => {
    expect(recoveryWarning(0, 0)).toBe(false);
  });
});

describe('recoveryCodesLow', () => {
  it('never warns a person who holds no set', () => {
    expect(recoveryCodesLow({ held: 0, unspent: 0, threshold: 3 })).toBe(false);
  });

  it('warns a person whose set has run down', () => {
    expect(recoveryCodesLow({ held: 10, unspent: 2, threshold: 3 })).toBe(true);
    expect(recoveryCodesLow({ held: 10, unspent: 0, threshold: 3 })).toBe(true);
  });

  it('does not warn a person with enough left', () => {
    expect(recoveryCodesLow({ held: 10, unspent: 3, threshold: 3 })).toBe(false);
  });
});
