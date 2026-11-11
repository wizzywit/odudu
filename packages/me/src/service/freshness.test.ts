import { describe, expect, it } from 'vitest';
import { freshnessChallenge, isFresh } from '#/service/freshness';

const AUTH = new Date('2026-11-11T10:00:00.000Z');
const after = (ms: number) => new Date(AUTH.getTime() + ms);

describe('isFresh', () => {
  it('is fresh just inside the window', () => {
    expect(isFresh(AUTH, after(299_999), 300)).toBe(true);
  });

  it('is fresh exactly at the window', () => {
    expect(isFresh(AUTH, after(300_000), 300)).toBe(true);
  });

  it('is stale a millisecond past the window', () => {
    expect(isFresh(AUTH, after(300_001), 300)).toBe(false);
  });

  it('is fresh when the sign-in is not in the past', () => {
    expect(isFresh(after(5_000), AUTH, 300)).toBe(true);
  });
});

describe('freshnessChallenge', () => {
  it('names the window as max_age', () => {
    expect(freshnessChallenge(300, null)).toBe(
      'Bearer error="insufficient_user_authentication", ' +
        'error_description="A recent sign-in is required", max_age="300"',
    );
  });

  it('adds acr_values when a second factor is asked for', () => {
    expect(freshnessChallenge(60, '2')).toBe(
      'Bearer error="insufficient_user_authentication", ' +
        'error_description="A recent sign-in is required", max_age="60", acr_values="2"',
    );
  });
});
