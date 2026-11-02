import { describe, expect, it } from 'vitest';
import {
  ALREADY_GONE,
  askedConsequence,
  revokeConsequence,
  revokeOutcome,
  REVOKED_TEXT,
} from '#/features/registration-tokens/services/revoke';

const problem = (status: number, detail?: string) => ({
  ok: false as const,
  kind: 'problem' as const,
  problem: { type: 'about:blank', title: 'x', status, ...(detail === undefined ? {} : { detail }) },
});

describe('revokeOutcome', () => {
  it('treats a token the server no longer has as already gone, and the list as stale', () => {
    expect(revokeOutcome(problem(404))).toEqual({ done: true, text: ALREADY_GONE });
  });

  it('is done and says so when the token was revoked', () => {
    expect(
      revokeOutcome({ ok: true, status: 204, data: undefined, etag: null, next: null }),
    ).toEqual({ done: true, text: REVOKED_TEXT });
  });

  it('names the capability a refusal needed', () => {
    const outcome = revokeOutcome(problem(403));
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('manage-clients');
  });

  it('does not claim a lost answer went through', () => {
    const outcome = revokeOutcome({ ok: false, kind: 'network' });
    expect(outcome.done).toBe(false);
    expect(outcome.text).toContain('not been sent again');
  });
});

describe('revokeConsequence', () => {
  it('says what is lost and what is kept', () => {
    const text = revokeConsequence({ remaining_uses: 2 });
    expect(text).toContain('2 uses');
    expect(text).toContain('already registered');
  });
});

describe('askedConsequence', () => {
  it('says nothing while no token is asked about, and what revoking costs once one is', () => {
    expect(askedConsequence(null)).toBe('');
    expect(askedConsequence({ remaining_uses: 2 })).toBe(revokeConsequence({ remaining_uses: 2 }));
  });
});
