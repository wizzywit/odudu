import { describe, expect, it } from 'vitest';
import { DEFAULT_MINT, mintProblems, MINT_LIMITS } from '#/pages/registration-tokens/services/mint';

describe('mintProblems', () => {
  it('accepts the defaults and both ends of each range', () => {
    expect(mintProblems(DEFAULT_MINT)).toEqual({});
    expect(mintProblems({ uses: 1, ttl_seconds: 60 })).toEqual({});
    expect(mintProblems({ uses: 2_147_483_647, ttl_seconds: 31_536_000 })).toEqual({});
  });

  it('names the range of each field it refuses', () => {
    const problems = mintProblems({ uses: 0, ttl_seconds: 59 });
    expect(problems.uses).toContain('1 to 2,147,483,647');
    expect(problems.ttl_seconds).toContain('60 seconds');
    expect(problems.ttl_seconds).toContain('365 days');
  });

  it('words the two rules exactly: uses grouped, the lifetime raw with its hand-written reading', () => {
    const problems = mintProblems({ uses: 0, ttl_seconds: 59 });
    expect(problems.uses).toBe('Uses is a whole number from 1 to 2,147,483,647.');
    expect(problems.ttl_seconds).toBe(
      'Lifetime is a whole number of seconds, from 60 seconds (1 minute) to 31536000 seconds (365 days).',
    );
  });

  it('refuses what is not a whole number, as a cleared field is', () => {
    const problems = mintProblems({ uses: Number.NaN, ttl_seconds: 90.5 });
    expect(problems.uses).toContain('whole number');
    expect(problems.ttl_seconds).toContain('whole number');
  });

  it('refuses one past either end of each range', () => {
    expect(Object.keys(mintProblems({ uses: 2_147_483_648, ttl_seconds: 31_536_001 }))).toEqual([
      'uses',
      'ttl_seconds',
    ]);
  });

  it('keeps the limits the contract states', () => {
    expect(MINT_LIMITS).toEqual({
      uses: { min: 1, max: 2_147_483_647 },
      ttl_seconds: { min: 60, max: 31_536_000 },
    });
  });
});
