import { describe, expect, it } from 'vitest';
import {
  askingAgainst,
  askToRemove,
  askToRevoke,
  credentialDialogOf,
  credentialDialog,
} from '#/features/subjects/services/credentialAsk';

describe('credential asks', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', created_at: 'x' },
    last: false,
  } as const;
  const lastFactor = { ...factor, last: true } as const;

  it('knows which asks hold a last factor, from the factors the subject has', () => {
    const totp = { id: 't', type: 'totp', created_at: 'x' } as const;
    const key = { id: 'w', type: 'webauthn', created_at: 'x' } as const;
    expect(askToRemove([totp], totp)).toEqual({ kind: 'factor', credential: totp, last: true });
    expect(askToRemove([totp, key], totp)).toMatchObject({ last: false });
    expect(askToRevoke([totp])).toEqual({ kind: 'recovery-codes', hasFactor: true });
    expect(askToRevoke([])).toEqual({ kind: 'recovery-codes', hasFactor: false });
  });

  it('asks for each change in its own words, and for your own password differently', () => {
    expect(credentialDialog({ kind: 'password' }, 'ada', false)).toMatchObject({
      title: 'Issue ada a one-time password?',
      confirmLabel: 'Issue password',
      tone: 'primary',
      consequence: expect.stringMatching(/^This replaces the password ada has/u) as string,
    });
    expect(credentialDialog({ kind: 'password' }, 'ada', true).consequence).toMatch(
      /^This replaces your own password/u,
    );
    expect(credentialDialog(factor, 'ada', false)).toMatchObject({
      title: 'Remove ada’s authenticator app (TOTP)?',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    expect(
      credentialDialog({ kind: 'recovery-codes', hasFactor: true }, 'ada', false),
    ).toMatchObject({
      title: 'Revoke ada’s recovery codes?',
      confirmLabel: 'Revoke recovery codes',
      tone: 'danger',
      choice: { label: 'Ask for a new set at next sign-in' },
    });
    expect(
      credentialDialog({ kind: 'recovery-codes', hasFactor: false }, 'ada', false).choice,
    ).toBeUndefined();
    expect(credentialDialog(factor, 'ada', false).choice).toBeUndefined();
    expect(credentialDialog(factor, 'ada', false).consequence).not.toContain('recovery codes');
    const last = credentialDialog(lastFactor, 'ada', false);
    expect(last.consequence).toContain('last second factor');
    expect(last.consequence).toContain('recovery codes are revoked with it');
    expect(last.choice?.label).toBe('Also end ada’s sessions');
    expect(last.choice?.note).toContain('unticked');
    expect(credentialDialog({ kind: 'lockout' }, 'ada', false)).toMatchObject({
      title: 'Clear ada’s lockout?',
      confirmLabel: 'Clear lockout',
      tone: 'primary',
    });
  });
});

describe('askingAgainst', () => {
  const totp = { id: 't', type: 'totp', created_at: 'x' } as const;
  const key = { id: 'w', type: 'webauthn', created_at: 'x' } as const;
  const ready = (items: (typeof totp | typeof key)[]) =>
    ({ status: 'ready', data: { items } }) as const;

  it('says the ask against the list as it stands now, not as it stood', () => {
    const asked = askToRemove([totp, key], totp);
    expect(asked).toMatchObject({ last: false });
    expect(askingAgainst(asked, ready([totp]))).toMatchObject({ last: true });
    expect(askingAgainst(askToRemove([totp], totp), ready([totp, key]))).toMatchObject({
      last: false,
    });
    expect(askingAgainst(askToRevoke([totp]), ready([]))).toMatchObject({ hasFactor: false });
  });

  it('keeps the ask while the list is not there to judge it by', () => {
    const asked = askToRemove([totp], totp);
    expect(askingAgainst(asked, { status: 'loading' })).toBe(asked);
    expect(askingAgainst(null, ready([totp]))).toBeNull();
    expect(askingAgainst({ kind: 'lockout' }, ready([totp]))).toEqual({ kind: 'lockout' });
  });
});

describe('small model reads', () => {
  it('asks no confirmation when nothing is being asked', () => {
    expect(credentialDialogOf(null, 'ada', false)).toBeNull();
    expect(credentialDialogOf({ kind: 'lockout' }, 'ada', false)?.confirmLabel).toBe(
      'Clear lockout',
    );
  });
});
