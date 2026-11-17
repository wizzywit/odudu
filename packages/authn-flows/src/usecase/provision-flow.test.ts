import { describe, expect, it } from 'vitest';
import { BROWSER_FLOW_DEFAULT } from '#/usecase/provision-flow';

describe('the default browser flow', () => {
  // The low-recovery-code warning is read from the "me" API; a sign-in is
  // never asked for a step on its account.
  it('holds exactly the sign-in steps, with none for a recovery warning', () => {
    expect(BROWSER_FLOW_DEFAULT).toEqual([
      { authenticator: 'passkey', requirement: 'alternative' },
      { authenticator: 'password', requirement: 'alternative' },
      { authenticator: 'otp', requirement: 'conditional' },
      { authenticator: 'recovery-code', requirement: 'conditional' },
    ]);
  });
});
