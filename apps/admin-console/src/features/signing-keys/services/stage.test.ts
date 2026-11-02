import { describe, expect, it } from 'vitest';
import {
  ALG_OPTIONS,
  algOf,
  DEFAULT_ALG,
  defaultAlg,
  stageFailure,
  stagedText,
} from '#/features/signing-keys/services/stage';

describe('stage', () => {
  it('starts from the active key’s algorithm, since a rotation usually keeps it', () => {
    const active = { alg: 'RS256' as const };
    expect(defaultAlg(active)).toBe('RS256');
    expect(defaultAlg(undefined)).toBe('ES256');
  });

  it('offers both algorithms the server has, ES256 first', () => {
    expect(ALG_OPTIONS.map((option) => option.id)).toEqual(['ES256', 'RS256']);
    expect(DEFAULT_ALG).toBe('ES256');
  });

  it('reads a choice back as an algorithm, or the default for anything else', () => {
    expect(algOf('RS256')).toBe('RS256');
    expect(algOf('nope')).toBe('ES256');
  });

  it('says a staged key is published but does not sign yet', () => {
    expect(stagedText({ alg: 'RS256', kid: 'kid-1' })).toBe(
      'An RS256 key, kid-1, was staged. It is published but does not sign until you promote it.',
    );
  });

  it('never offers to send again after a lost answer', () => {
    const outcome = stageFailure({ ok: false, kind: 'network' });
    expect(outcome.unconfirmed).toBe(true);
    expect(outcome.message).toContain('has not been sent again');
  });

  it('names the capability a refusal needed and reports it', () => {
    const outcome = stageFailure({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
    });
    expect(outcome.report).toBe(true);
    expect(outcome.message).toContain('manage-keys');
  });
});
