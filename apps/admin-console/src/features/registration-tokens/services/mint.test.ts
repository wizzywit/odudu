import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINT,
  isValid,
  mintFailure,
  mintProblems,
  mintedText,
  MINT_LIMITS,
} from '#/features/registration-tokens/services/mint';

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

describe('mintFailure', () => {
  it('places a refused value under its field', () => {
    const outcome = mintFailure({
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        errors: [{ path: 'uses', message: 'must be at most 2147483647' }],
      },
    });
    expect(outcome.errors).toEqual({ uses: 'must be at most 2147483647' });
  });

  it('names the capability a refusal needed and asks for whoami to be read again', () => {
    const outcome = mintFailure({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
    });
    expect(outcome.message).toContain('manage-clients');
    expect(outcome.report).toBe(true);
  });

  it('does not offer a second send when the answer was lost, and points at the list', () => {
    const outcome = mintFailure({ ok: false, kind: 'network' });
    expect(outcome.unconfirmed).toBe(true);
    expect(outcome.message).toContain('not been sent again');
  });

  it('says a token that came back unreadable may exist and is lost', () => {
    const outcome = mintFailure({ ok: false, kind: 'schema' });
    expect(outcome.message).toMatch(/may have been created/u);
    expect(outcome.message).toMatch(/revoke/iu);
  });
});

describe('mintedText', () => {
  it('says how many uses and until when, and never the token', () => {
    const text = mintedText({ remaining_uses: 3, expires_at: '2026-10-12T10:00:00.000Z' });
    expect(text).toBe('Registration token minted: 3 uses, until 2026-10-12 10:00:00 UTC.');
  });

  it('says a single use in the singular', () => {
    expect(mintedText({ remaining_uses: 1, expires_at: '2026-10-12T10:00:00.000Z' })).toContain(
      '1 use,',
    );
  });
});

describe('isValid', () => {
  it('holds only for no error at all', () => {
    expect(isValid({})).toBe(true);
    expect(isValid({ uses: 'no' })).toBe(false);
  });
});
