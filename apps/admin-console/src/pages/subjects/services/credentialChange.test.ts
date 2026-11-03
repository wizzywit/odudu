import { describe, expect, it } from 'vitest';
import { CHOICE_DEFAULTS } from '#/pages/subjects/services/credentialChoices';
import { credentialChangeOf, staleReadOf } from '#/pages/subjects/services/credentialChange';

describe('credential changes', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', createdAt: 'x' },
    last: false,
  } as const;
  const lastFactor = { ...factor, last: true } as const;
  const keep = CHOICE_DEFAULTS;

  it('maps what was asked to the change that is sent, none for a factor without an id', () => {
    expect(credentialChangeOf(factor, keep)).toEqual({
      kind: 'factor',
      credentialId: 'c1',
      endSessions: false,
    });
    expect(
      credentialChangeOf(
        { kind: 'factor', credential: { type: 'totp', createdAt: 'x' }, last: false },
        keep,
      ),
    ).toBeNull();
    expect(credentialChangeOf({ kind: 'lockout' }, keep)).toEqual({ kind: 'lockout' });
  });

  it('ends the sessions only when asked, and only for the last factor', () => {
    const ticked = { ...keep, endSessions: true };
    expect(credentialChangeOf(lastFactor, ticked)).toMatchObject({ endSessions: true });
    expect(credentialChangeOf(factor, ticked)).toMatchObject({ endSessions: false });
    expect(credentialChangeOf(lastFactor, keep)).toMatchObject({ endSessions: false });
  });

  it('asks for a new set unless unticked, and never for a subject with no factor left', () => {
    const revoke = { kind: 'recovery-codes', hasFactor: true } as const;
    expect(credentialChangeOf(revoke, keep)).toEqual({
      kind: 'recovery-codes',
      requireNewSet: true,
    });
    expect(credentialChangeOf(revoke, { ...keep, newSet: false })).toEqual({
      kind: 'recovery-codes',
      requireNewSet: false,
    });
    expect(credentialChangeOf({ kind: 'recovery-codes', hasFactor: false }, keep)).toEqual({
      kind: 'recovery-codes',
      requireNewSet: false,
    });
  });
});

describe('staleReadOf', () => {
  it('makes a lockout change stale its own read, and any other the credentials list', () => {
    expect(staleReadOf({ kind: 'lockout' })).toBe('lockout');
    expect(staleReadOf({ kind: 'factor', credentialId: 'c1', endSessions: false })).toBe(
      'credentials',
    );
    expect(staleReadOf({ kind: 'recovery-codes', requireNewSet: true })).toBe('credentials');
  });
});
