import { describe, expect, it } from 'vitest';
import {
  askingAgainst,
  askToRemove,
  askToRevoke,
  CHOICE_DEFAULTS,
  choiceControl,
  choiceKeyOf,
  choicesWith,
  credentialDialogOf,
  credentialChangeOf,
  credentialDialog,
  credentialDoneText,
  credentialFailureText,
  recoveryCodesText,
  credentialsOf,
  lockoutSummary,
  staleReadOf,
} from '#/features/subjects/services/credentials';
import { failure, refusal } from '#/testing/failures';

describe('credentials', () => {
  it('splits a list into the password, the second factors and the recovery-code count', () => {
    const split = credentialsOf([
      { id: 'p', type: 'password', created_at: '2026-01-01T00:00:00.000Z', expired: false },
      { id: 't', type: 'totp', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'w', type: 'webauthn', created_at: '2026-01-03T00:00:00.000Z' },
      { type: 'recovery-code', created_at: '2026-01-04T00:00:00.000Z', recovery_code_count: 7 },
    ]);
    expect(split.password?.id).toBe('p');
    expect(split.factors.map((factor) => factor.id)).toEqual(['t', 'w']);
    expect(split.recoveryCodes).toBe(7);
  });

  it('holds no password, no factors and no codes for an empty list', () => {
    expect(credentialsOf([])).toEqual({ password: null, factors: [], recoveryCodes: null });
  });
});

describe('the lockout', () => {
  it('says a subject with nothing on record has no failed sign-ins', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 0,
        last_failure_at: null,
      }),
    ).toEqual({ tone: 'neutral', state: 'not locked', text: 'No failed sign-ins on record.' });
  });

  it('says how many failures a subject that is not locked has on record', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 1,
        last_failure_at: '2026-09-29T09:58:00.000Z',
      }),
    ).toMatchObject({ tone: 'neutral', state: 'not locked', text: /^1 failed sign-in on record/u });
  });

  it('says a locked subject is locked, and after how many failures', () => {
    expect(
      lockoutSummary({
        locked: true,
        locked_until: '2026-09-29T10:02:00.000Z',
        failure_count: 6,
        last_failure_at: '2026-09-29T09:59:00.000Z',
      }),
    ).toMatchObject({ tone: 'danger', state: 'locked', text: /after 6 failed sign-ins/u });
  });
});

describe('credential changes', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', created_at: 'x' },
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
        { kind: 'factor', credential: { type: 'totp', created_at: 'x' }, last: false },
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

  it('knows which asks hold a last factor, from the factors the subject has', () => {
    const totp = { id: 't', type: 'totp', created_at: 'x' } as const;
    const key = { id: 'w', type: 'webauthn', created_at: 'x' } as const;
    expect(askToRemove([totp], totp)).toEqual({ kind: 'factor', credential: totp, last: true });
    expect(askToRemove([totp, key], totp)).toMatchObject({ last: false });
    expect(askToRevoke([totp])).toEqual({ kind: 'recovery-codes', hasFactor: true });
    expect(askToRevoke([])).toEqual({ kind: 'recovery-codes', hasFactor: false });
  });

  it('offers a choice only where one changes the outcome, ticked for a new set only', () => {
    expect(choiceKeyOf(factor)).toBeNull();
    expect(choiceKeyOf(lastFactor)).toBe('endSessions');
    expect(choiceKeyOf({ kind: 'recovery-codes', hasFactor: true })).toBe('newSet');
    expect(choiceKeyOf({ kind: 'recovery-codes', hasFactor: false })).toBeNull();
    expect(choiceKeyOf({ kind: 'lockout' })).toBeNull();
    expect(choiceKeyOf({ kind: 'password' })).toBeNull();
    expect(CHOICE_DEFAULTS).toEqual({ newSet: true, endSessions: false });
    const seen: unknown[] = [];
    const control = choiceControl(lastFactor, CHOICE_DEFAULTS, (next) => seen.push(next));
    expect(control?.checked).toBe(false);
    control?.onChange(true);
    expect(seen).toEqual([{ newSet: true, endSessions: true }]);
    expect(choiceControl(factor, CHOICE_DEFAULTS, () => undefined)).toBeNull();
    expect(choiceControl(null, CHOICE_DEFAULTS, () => undefined)).toBeNull();
    expect(choicesWith(CHOICE_DEFAULTS, 'newSet', false)).toEqual({
      newSet: false,
      endSessions: false,
    });
  });

  it('says what was done, by name', () => {
    expect(credentialDoneText('ada', factor)).toBe('Authenticator app (TOTP) removed from ada.');
    expect(credentialDoneText('ada', { kind: 'recovery-codes', hasFactor: true })).toBe(
      "ada's recovery codes are revoked.",
    );
    expect(credentialDoneText('ada', { kind: 'lockout' })).toBe("ada's lockout is cleared.");
  });

  it('says what a failure was, with what it concerned', () => {
    expect(credentialFailureText('The password', failure('network'))).toBe(
      'Could not confirm the result. The password has not been sent again; the tab shows what the server holds now.',
    );
    expect(credentialFailureText('The change', failure('schema'))).toBe(
      'The change may have happened, but the answer could not be read. The tab shows what the server holds now.',
    );
    expect(credentialFailureText('The change', failure('defect'))).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
    expect(credentialFailureText('The change', refusal(403))).toBe(
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    );
    expect(
      credentialFailureText(
        'The change',
        refusal(403, { detail: 'end_sessions needs manage-sessions' }),
      ),
    ).toBe(
      'Refused: it needs the manage-sessions capability, or the subject holds an admin capability you do not.',
    );
    expect(credentialFailureText('The change', refusal(500, { detail: 'boom' }))).toBe(
      'Refused: boom',
    );
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

  it('counts the codes that are left', () => {
    expect(recoveryCodesText('ada', null)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 0)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 1)).toBe('1 unspent recovery code');
    expect(recoveryCodesText('ada', 8)).toBe('8 unspent recovery codes');
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

describe('staleReadOf', () => {
  it('makes a lockout change stale its own read, and any other the credentials list', () => {
    expect(staleReadOf({ kind: 'lockout' })).toBe('lockout');
    expect(staleReadOf({ kind: 'factor', credentialId: 'c1', endSessions: false })).toBe(
      'credentials',
    );
    expect(staleReadOf({ kind: 'recovery-codes', requireNewSet: true })).toBe('credentials');
  });
});
