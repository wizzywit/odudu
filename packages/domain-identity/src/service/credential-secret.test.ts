import { describe, expect, it } from 'vitest';
import { parseCredentialSecret } from '#/service/credential-secret';

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
