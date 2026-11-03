import { describe, expect, it } from 'vitest';
import { failure, refusal } from '#/testing/failures';
import {
  credentialDoneText,
  credentialFailureText,
  recoveryCodesText,
} from '#/features/subjects/services/credentialOutcome';

describe('credential outcomes', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', createdAt: 'x' },
    last: false,
  } as const;

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

  it('counts the codes that are left', () => {
    expect(recoveryCodesText('ada', null)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 0)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 1)).toBe('1 unspent recovery code');
    expect(recoveryCodesText('ada', 8)).toBe('8 unspent recovery codes');
  });
});
