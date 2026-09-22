import { totpCode, totpCounter } from '@odudu/crypto';
import { describe, expect, it } from 'vitest';
import { otpApplicable, totpStep, type TotpSecret } from '#/service/authenticators/totp';

const SUBJECT = '11111111-1111-1111-1111-111111111111';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const NOW = new Date('2026-09-16T12:00:00.000Z');

function credential(overrides: Partial<TotpSecret> = {}): TotpSecret {
  return { kind: 'totp', secret: SECRET, digits: 6, lastStep: 0, ...overrides };
}

function currentCode(): string {
  return totpCode(SECRET, totpCounter(NOW));
}

describe('totpStep', () => {
  it('succeeds on the code the shared secret produces right now', () => {
    const result = totpStep(
      { code: currentCode() },
      { subjectId: SUBJECT, secret: credential(), now: NOW },
    );

    expect(result).toEqual({ kind: 'success', subjectId: SUBJECT, step: totpCounter(NOW) });
  });

  it('fails on a wrong code', () => {
    const wrong = currentCode() === '000000' ? '111111' : '000000';

    const result = totpStep(
      { code: wrong },
      { subjectId: SUBJECT, secret: credential(), now: NOW },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('challenges for a code when none was submitted', () => {
    const result = totpStep({}, { subjectId: SUBJECT, secret: credential(), now: NOW });

    expect(result).toEqual({ kind: 'challenge', form: 'otp' });
  });

  // A subject with no TOTP credential must not be able to sign in with any
  // code at all — including the one a secret the caller failed to find
  // would have produced.
  it('fails rather than succeeding when the subject has no credential', () => {
    const result = totpStep(
      { code: currentCode() },
      { subjectId: SUBJECT, secret: null, now: NOW },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('fails when the caller resolved no subject', () => {
    const result = totpStep(
      { code: currentCode() },
      { subjectId: null, secret: credential(), now: NOW },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  // RFC 6238 §5.2: the verifier must not accept a second attempt of an OTP
  // that already validated. `lastStep` is how a stored credential carries
  // that refusal across calls.
  it('refuses a code whose step the credential has already used', () => {
    const result = totpStep(
      { code: currentCode() },
      { subjectId: SUBJECT, secret: credential({ lastStep: totpCounter(NOW) }), now: NOW },
    );

    expect(result).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('otpApplicable', () => {
  const NOTHING_SATISFIED: ReadonlySet<string> = new Set();
  const AFTER_A_PASSKEY: ReadonlySet<string> = new Set(['passkey']);

  it('applies to a subject who has enrolled, whether or not the tenant requires it', () => {
    expect(otpApplicable({ hasTotp: true }, { otpRequired: true }, NOTHING_SATISFIED)).toBe(true);
    expect(otpApplicable({ hasTotp: true }, { otpRequired: false }, NOTHING_SATISFIED)).toBe(true);
  });

  it('applies to a subject who has not enrolled when the tenant requires it', () => {
    expect(otpApplicable({ hasTotp: false }, { otpRequired: true }, NOTHING_SATISFIED)).toBe(true);
  });

  it('does not apply to a subject who has not enrolled in a tenant that does not require it', () => {
    expect(otpApplicable({ hasTotp: false }, { otpRequired: false }, NOTHING_SATISFIED)).toBe(
      false,
    );
  });

  it('does not apply after a passkey, which is already two factors', () => {
    expect(otpApplicable({ hasTotp: true }, { otpRequired: true }, AFTER_A_PASSKEY)).toBe(false);
    expect(otpApplicable({ hasTotp: false }, { otpRequired: true }, AFTER_A_PASSKEY)).toBe(false);
  });

  it('still applies after a password, which is one', () => {
    expect(otpApplicable({ hasTotp: true }, { otpRequired: false }, new Set(['password']))).toBe(
      true,
    );
  });
});
