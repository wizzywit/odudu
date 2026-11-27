import { describe, expect, it } from 'vitest';
import { confirmationAccepted } from '#/service/confirmation';

const C = { tier: 'C', confirmWith: 'auditors' } as const;

describe('what a decision carries', () => {
  it('accepts the exact text for a tier C approval, and nothing else', () => {
    expect(confirmationAccepted(C, true, 'auditors')).toBe(true);
    for (const typed of [undefined, '', 'Auditors', 'auditors ', ' auditors', 'auditor']) {
      expect(confirmationAccepted(C, true, typed), String(typed)).toBe(false);
    }
  });

  it('asks nothing for a refusal, whatever the tier', () => {
    expect(confirmationAccepted(C, false, undefined)).toBe(true);
    expect(confirmationAccepted(C, false, 'wrong')).toBe(true);
  });

  it('ignores the text for a tier A or B approval', () => {
    for (const tier of ['A', 'B'] as const) {
      expect(confirmationAccepted({ tier, confirmWith: null }, true, undefined)).toBe(true);
      expect(confirmationAccepted({ tier, confirmWith: null }, true, 'anything')).toBe(true);
    }
  });

  it('never approves a tier C card that has no text to type', () => {
    expect(confirmationAccepted({ tier: 'C', confirmWith: null }, true, undefined)).toBe(false);
    expect(confirmationAccepted({ tier: 'C', confirmWith: null }, true, 'x')).toBe(false);
  });
});
