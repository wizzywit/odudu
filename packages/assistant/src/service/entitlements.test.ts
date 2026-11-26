import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { limitsFromSettings } from '#/service/entitlements';

describe('limitsFromSettings', () => {
  it('maps the tenant settings onto the limits the loop reads', () => {
    const limits = limitsFromSettings({
      ...ASSISTANT_SETTING_DEFAULTS,
      assistant_monthly_tokens_fast: 11,
      assistant_monthly_tokens_standard: 22,
      assistant_monthly_tokens_deep: 33,
      assistant_max_concurrent: 4,
      assistant_max_steps_per_turn: 6,
    });
    expect(limits.monthlyTokensBySlot).toEqual({ fast: 11, standard: 22, deep: 33 });
    expect(limits.maxConcurrent).toBe(4);
    expect(limits.maxStepsPerTurn).toBe(6);
  });

  it('offers both modes, the read and write tool classes and any model the operator set', () => {
    const limits = limitsFromSettings(ASSISTANT_SETTING_DEFAULTS);
    expect(limits.modes).toEqual(['ask', 'act']);
    expect(limits.toolClasses).toEqual(['read', 'write']);
    expect(limits.allowedModels).toEqual([]);
  });
});
