import { describe, expect, it } from 'vitest';
import type { GatewayFailure } from '#/shared/service/result.ts';
import {
  credentialDialogOf,
  credentialChangeOf,
  credentialDialog,
  credentialDoneText,
  credentialFailureText,
  recoveryCodesText,
  credentialsOf,
  lockoutSummary,
} from '#/features/subjects/service/credentials.ts';

const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({ ok: false, kind });

const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

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
  } as const;

  it('maps what was asked to the change that is sent, none for a factor without an id', () => {
    expect(credentialChangeOf(factor)).toEqual({ kind: 'factor', credentialId: 'c1' });
    expect(
      credentialChangeOf({ kind: 'factor', credential: { type: 'totp', created_at: 'x' } }),
    ).toBeNull();
    expect(credentialChangeOf({ kind: 'recovery-codes' })).toEqual({ kind: 'recovery-codes' });
    expect(credentialChangeOf({ kind: 'lockout' })).toEqual({ kind: 'lockout' });
  });

  it('says what was done, by name', () => {
    expect(credentialDoneText('ada', factor)).toBe('Authenticator app (TOTP) removed from ada.');
    expect(credentialDoneText('ada', { kind: 'recovery-codes' })).toBe(
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
    expect(credentialDialog({ kind: 'recovery-codes' }, 'ada', false)).toMatchObject({
      title: 'Revoke ada’s recovery codes?',
      confirmLabel: 'Revoke recovery codes',
      tone: 'danger',
    });
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

describe('small model reads', () => {
  it('asks no confirmation when nothing is being asked', () => {
    expect(credentialDialogOf(null, 'ada', false)).toBeNull();
    expect(credentialDialogOf({ kind: 'lockout' }, 'ada', false)?.confirmLabel).toBe(
      'Clear lockout',
    );
  });
});
