import { describe, expect, it } from 'vitest';
import {
  EXCHANGE_ACTOR_LABEL,
  EXCHANGE_ACTOR_RULE,
  EXCHANGE_LABEL,
  EXCHANGE_PUBLIC_LABEL,
  EXCHANGE_PUBLIC_RULE,
  EXCHANGE_RULE,
} from '#/pages/clients/services/tokenExchange';

describe('the token exchange wording', () => {
  it('labels each switch differently', () => {
    expect(new Set([EXCHANGE_LABEL, EXCHANGE_PUBLIC_LABEL, EXCHANGE_ACTOR_LABEL]).size).toBe(3);
  });

  it('says that each new limit is off until turned on and what it lets through', () => {
    expect(EXCHANGE_PUBLIC_RULE).toMatch(/public client/u);
    expect(EXCHANGE_PUBLIC_RULE).toMatch(/refused/u);
    expect(EXCHANGE_ACTOR_RULE).toMatch(/another client/u);
    expect(EXCHANGE_ACTOR_RULE).toMatch(/refused/u);
  });

  it('says every switch has no effect without the token exchange grant', () => {
    for (const rule of [EXCHANGE_RULE, EXCHANGE_PUBLIC_RULE, EXCHANGE_ACTOR_RULE]) {
      expect(rule).toMatch(/token exchange grant/u);
    }
  });
});
