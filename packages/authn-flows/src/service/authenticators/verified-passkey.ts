import { PASSKEY, PASSKEY_UNVERIFIED } from '#/service/authenticators/names';

// Whether the sign-in ran a passkey assertion that verified the person
// (WebAuthn L3 §6.1.3 user verification), which makes the passkey two factors.
// One that proved only possession is recorded beside it as unverified. Adding
// a password to an account that holds none is authenticated this way and no
// weaker (NIST SP 800-63B-4 §4.1.2.1).
export function signedInWithVerifiedPasskey(authenticators: readonly string[]): boolean {
  return authenticators.includes(PASSKEY) && !authenticators.includes(PASSKEY_UNVERIFIED);
}
