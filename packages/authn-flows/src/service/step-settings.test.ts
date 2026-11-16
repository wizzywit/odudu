import { describe, expect, it } from 'vitest';
import { type AuthenticatorPolicy } from '#/service/authenticator-policy';
import { effectiveAuthenticatorPolicy } from '#/service/step-settings';

const tenant: AuthenticatorPolicy = {
  totp: { algorithm: 'SHA1', digits: 6, period: 30 },
  webauthn: { userVerification: 'required', residentKey: 'required' },
  recoveryCodeCount: 10,
};

describe('effectiveAuthenticatorPolicy', () => {
  it('is the tenant policy when no step carries settings', () => {
    expect(
      effectiveAuthenticatorPolicy(tenant, [
        { authenticator: 'password', requirement: 'required' },
        { authenticator: 'otp', requirement: 'required' },
      ]),
    ).toEqual(tenant);
    expect(effectiveAuthenticatorPolicy(tenant, [])).toEqual(tenant);
  });

  it('takes a key the step names and the tenant value for each key it omits', () => {
    expect(
      effectiveAuthenticatorPolicy(tenant, [
        { authenticator: 'otp', requirement: 'required', settings: { digits: 8 } },
      ]).totp,
    ).toEqual({ algorithm: 'SHA1', digits: 8, period: 30 });
  });

  it('reads each authenticator from its own step', () => {
    expect(
      effectiveAuthenticatorPolicy(tenant, [
        {
          authenticator: 'passkey',
          requirement: 'alternative',
          settings: { user_verification: 'preferred' },
        },
        { authenticator: 'recovery-code', requirement: 'conditional', settings: { count: 12 } },
      ]),
    ).toEqual({
      totp: tenant.totp,
      webauthn: { userVerification: 'preferred', residentKey: 'required' },
      recoveryCodeCount: 12,
    });
  });

  it('ignores a step that is disabled, as the flow does not run it', () => {
    expect(
      effectiveAuthenticatorPolicy(tenant, [
        { authenticator: 'otp', requirement: 'disabled', settings: { digits: 8 } },
      ]),
    ).toEqual(tenant);
  });
});
