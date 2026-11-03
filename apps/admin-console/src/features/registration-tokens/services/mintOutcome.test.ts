import { describe, expect, it } from 'vitest';
import { mintFailure, mintedText } from '#/features/registration-tokens/services/mintOutcome';

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
