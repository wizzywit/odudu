import type { CredentialSummary } from '@odudu/domain-identity';
import { describe, expect, it } from 'vitest';
import { canRemove, holdsSecondFactor } from '#/service/removal-rule';

const AT = new Date('2026-01-01T00:00:00Z');

let next = 0;
function cred(type: CredentialSummary['type']): CredentialSummary {
  next += 1;
  return { id: `id-${String(next)}`, type, label: null, createdAt: AT, lastUsedAt: null };
}

const OK = { ok: true } as const;
const LAST_SIGN_IN = { ok: false, code: 'last_sign_in_method' } as const;
const LAST_FACTOR = { ok: false, code: 'last_second_factor' } as const;

describe('canRemove', () => {
  it('lets a passkey go while a password remains', () => {
    const password = cred('password');
    const passkey = cred('webauthn');
    expect(canRemove([password, passkey], passkey, false)).toEqual(OK);
  });

  it('lets one of two passkeys go with no password', () => {
    const a = cred('webauthn');
    const b = cred('webauthn');
    expect(canRemove([a, b], a, false)).toEqual(OK);
  });

  it('refuses the only passkey of a person with no password', () => {
    const passkey = cred('webauthn');
    expect(canRemove([passkey], passkey, false)).toEqual(LAST_SIGN_IN);
  });

  it('does not count a TOTP as a way to sign in', () => {
    const passkey = cred('webauthn');
    const totp = cred('totp');
    expect(canRemove([passkey, totp], passkey, false)).toEqual(LAST_SIGN_IN);
  });

  it('does not count a recovery code or a retired password as a way to sign in', () => {
    const passkey = cred('webauthn');
    expect(
      canRemove([passkey, cred('recovery-code'), cred('password-history')], passkey, false),
    ).toEqual(LAST_SIGN_IN);
  });

  it('refuses the only password of a person with no passkey', () => {
    const password = cred('password');
    expect(canRemove([password], password, false)).toEqual(LAST_SIGN_IN);
    expect(canRemove([password, cred('totp')], password, false)).toEqual(LAST_SIGN_IN);
  });

  it('lets the last TOTP go where no second factor is required', () => {
    const password = cred('password');
    const totp = cred('totp');
    expect(canRemove([password, totp], totp, false)).toEqual(OK);
  });

  it('refuses the last TOTP where the tenant requires a second factor', () => {
    const password = cred('password');
    const totp = cred('totp');
    expect(canRemove([password, totp], totp, true)).toEqual(LAST_FACTOR);
  });

  it('lets one TOTP go where another remains', () => {
    const password = cred('password');
    const a = cred('totp');
    const b = cred('totp');
    expect(canRemove([password, a, b], a, true)).toEqual(OK);
  });

  it('refuses the last passkey where a second factor is required and it is the only one', () => {
    const password = cred('password');
    const passkey = cred('webauthn');
    expect(canRemove([password, passkey], passkey, true)).toEqual(LAST_FACTOR);
  });

  it('lets a passkey go where a TOTP is also held and a second factor is required', () => {
    const password = cred('password');
    const passkey = cred('webauthn');
    expect(canRemove([password, passkey, cred('totp')], passkey, true)).toEqual(OK);
  });

  it('names the lost sign-in before the lost second factor', () => {
    const passkey = cred('webauthn');
    expect(canRemove([passkey], passkey, true)).toEqual(LAST_SIGN_IN);
  });

  it('judges what is left once the target is out, whether or not held lists it', () => {
    const password = cred('password');
    const passkey = cred('webauthn');
    expect(canRemove([password], passkey, false)).toEqual(OK);
    expect(canRemove([], passkey, false)).toEqual(LAST_SIGN_IN);
  });
});

describe('holdsSecondFactor', () => {
  it.each([
    [['password'], false],
    [['password', 'recovery-code'], false],
    [['password', 'totp'], true],
    [['password', 'webauthn'], true],
    [[], false],
  ] as const)('for %j answers %s', (types, expected) => {
    expect(holdsSecondFactor(types.map(cred))).toBe(expected);
  });
});
