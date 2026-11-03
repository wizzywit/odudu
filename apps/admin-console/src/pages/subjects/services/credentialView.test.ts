import { describe, expect, it } from 'vitest';
import { heldCredentials } from '#/pages/subjects/services/credentialView';
import type { Credential } from '#/pages/subjects/types/credential';

const TOTP: Credential = { id: 'c1', type: 'totp', createdAt: '2026-05-01T09:00:00.000Z' };
const PASSKEY: Credential = { id: 'c2', type: 'webauthn', createdAt: '2026-05-02T09:00:00.000Z' };
const PASSWORD: Credential = { type: 'password', createdAt: '2026-04-01T09:00:00.000Z' };
const CODES: Credential = {
  type: 'recovery-code',
  createdAt: '2026-05-03T09:00:00.000Z',
  recoveryCodeCount: 7,
};

describe('heldCredentials', () => {
  it('is null until the credentials have been read', () => {
    expect(heldCredentials({ status: 'loading' }, 'ada')).toBeNull();
    expect(
      heldCredentials({ status: 'failed', refused: false, retry: () => undefined }, 'ada'),
    ).toBe(null);
  });

  it('labels each factor and asks to remove it knowing whether it is the last', () => {
    const held = heldCredentials(
      { status: 'ready', data: [PASSWORD, TOTP, PASSKEY, CODES] },
      'ada',
    );
    expect(held?.password).toEqual(PASSWORD);
    expect(held?.factors.map((row) => row.label)).toEqual(['Authenticator app (TOTP)', 'Passkey']);
    expect(held?.factors[0]?.remove).toEqual({ kind: 'factor', credential: TOTP, last: false });
    expect(held?.recoveryCodes).toBe(7);
    expect(held?.revoke).toEqual({ kind: 'recovery-codes', hasFactor: true });
  });

  it('says the recovery codes of a subject that holds none', () => {
    const held = heldCredentials({ status: 'ready', data: [PASSWORD] }, 'ada');
    expect(held?.factors).toEqual([]);
    expect(held?.recoveryCodes).toBeNull();
    expect(held?.revoke).toEqual({ kind: 'recovery-codes', hasFactor: false });
  });
});
