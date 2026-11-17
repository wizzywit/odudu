import { describe, expect, it } from 'vitest';
import { signedInWithVerifiedPasskey } from '#/service/authenticators/verified-passkey';

describe('signedInWithVerifiedPasskey', () => {
  it('holds for a sign-in whose passkey assertion verified the person', () => {
    expect(signedInWithVerifiedPasskey(['passkey'])).toBe(true);
    expect(signedInWithVerifiedPasskey(['passkey', 'otp'])).toBe(true);
  });

  it('does not hold for a passkey that proved only possession', () => {
    expect(signedInWithVerifiedPasskey(['passkey', 'passkey-unverified'])).toBe(false);
  });

  it('does not hold for a sign-in that ran no passkey, nor for one that recorded nothing', () => {
    expect(signedInWithVerifiedPasskey(['password'])).toBe(false);
    expect(signedInWithVerifiedPasskey(['password', 'otp', 'recovery-code'])).toBe(false);
    expect(signedInWithVerifiedPasskey([])).toBe(false);
  });
});
