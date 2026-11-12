import { describe, expect, it } from 'vitest';
import { parseCredentialSecret, serializeCredentialSecret } from '#/service/credential-secret';

describe('parseCredentialSecret', () => {
  it('reads a password secret', () => {
    expect(parseCredentialSecret('password', { hash: '$argon2id$v=19$x' })).toEqual({
      kind: 'password',
      hash: '$argon2id$v=19$x',
    });
  });

  it('reads a totp secret with its last accepted step', () => {
    expect(
      parseCredentialSecret('totp', {
        secret: 'JBSWY3DPEHPK3PXP',
        digits: 6,
        lastStep: 57_000_000,
      }),
    ).toEqual({ kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 57_000_000 });
  });

  it('reads the parameters a totp secret was made under, and keeps them on the way out', () => {
    const stored = {
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 8,
      lastStep: 0,
      algorithm: 'SHA256',
      period: 60,
    };
    const parsed = parseCredentialSecret('totp', stored);
    expect(parsed).toEqual({ kind: 'totp', ...stored });
    expect(serializeCredentialSecret(parsed)).toEqual(stored);
  });

  it('refuses a totp algorithm and period nobody offers', () => {
    const base = { secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 };
    expect(() => parseCredentialSecret('totp', { ...base, algorithm: 'MD5' })).toThrow();
    expect(() => parseCredentialSecret('totp', { ...base, period: 0 })).toThrow();
  });

  it('reads the parameters a webauthn secret was made under, and keeps them on the way out', () => {
    const stored = {
      publicKey: 'pQECAyY',
      counter: 7,
      transports: ['internal'],
      userVerification: 'preferred',
      residentKey: 'discouraged',
    };
    const parsed = parseCredentialSecret('webauthn', stored);
    expect(parsed).toEqual({ kind: 'webauthn', ...stored });
    expect(serializeCredentialSecret(parsed)).toEqual(stored);
  });

  it('writes a secret without parameters exactly as before', () => {
    expect(
      serializeCredentialSecret({ kind: 'totp', secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 }),
    ).toEqual({ secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 });
  });

  it('reads a webauthn secret with its counter', () => {
    expect(
      parseCredentialSecret('webauthn', {
        publicKey: 'pQECAyY',
        counter: 7,
        transports: ['internal'],
      }),
    ).toEqual({ kind: 'webauthn', publicKey: 'pQECAyY', counter: 7, transports: ['internal'] });
  });

  it('reads a recovery-code secret', () => {
    expect(parseCredentialSecret('recovery-code', { hash: '$argon2id$v=19$rc' })).toEqual({
      kind: 'recovery-code',
      hash: '$argon2id$v=19$rc',
    });
  });

  // The shape a spent code carries. A strict object that refused this field
  // would throw on every read of a used code, which is every read the
  // "already used" refusal depends on.
  it('reads a recovery-code secret that has been spent', () => {
    expect(
      parseCredentialSecret('recovery-code', {
        hash: '$argon2id$v=19$rc',
        usedAt: '2026-09-16T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'recovery-code',
      hash: '$argon2id$v=19$rc',
      usedAt: '2026-09-16T12:00:00.000Z',
    });
  });

  it('reads a password-history secret', () => {
    expect(parseCredentialSecret('password-history', { hash: '$argon2id$v=19$old' })).toEqual({
      kind: 'password-history',
      hash: '$argon2id$v=19$old',
    });
  });

  it('throws on a secret whose shape does not match its type', () => {
    expect(() => parseCredentialSecret('totp', { hash: 'x' })).toThrow(/totp/);
  });

  it('throws rather than narrowing an unknown from the database loosely', () => {
    expect(() => parseCredentialSecret('password', null)).toThrow();
    expect(() => parseCredentialSecret('password', 'a raw string')).toThrow();
  });
});
