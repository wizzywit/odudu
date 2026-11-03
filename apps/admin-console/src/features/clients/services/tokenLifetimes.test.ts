import { describe, expect, it } from 'vitest';
import {
  LIFETIMES,
  lifetimeBounds,
  lifetimeRule,
  tenantLifetimeLabel,
} from '#/features/clients/services/tokenLifetimes';

describe('the lifetimes a client may be given', () => {
  it('names the three the server holds, each with the range it holds them to', () => {
    expect(LIFETIMES.map((each) => each.field)).toEqual([
      'access_token_ttl_seconds',
      'id_token_ttl_seconds',
      'refresh_token_ttl_seconds',
    ]);
    expect(lifetimeBounds('access_token_ttl_seconds')).toEqual({ min: 1, max: 3600 });
    expect(lifetimeBounds('refresh_token_ttl_seconds')).toEqual({ min: 1, max: undefined });
  });

  it('says the range with its duration reading', () => {
    expect(lifetimeRule('id_token_ttl_seconds')).toBe('Between 1 s and 3600 s · 1 hour.');
    expect(lifetimeRule('refresh_token_ttl_seconds')).toBe('At least 1 s.');
  });

  it('starts every lifetime within the range', () => {
    for (const each of LIFETIMES) {
      const { min, max } = lifetimeBounds(each.field);
      expect(each.start).toBeGreaterThanOrEqual(min);
      expect(each.start).toBeLessThanOrEqual(max ?? Number.MAX_SAFE_INTEGER);
    }
  });
});

describe('tenantLifetimeLabel', () => {
  it('names the lifetime it hands back, so three toggles are told apart', () => {
    expect(tenantLifetimeLabel('Access token lifetime')).toBe(
      "Use the tenant's access token lifetime",
    );
  });
});
