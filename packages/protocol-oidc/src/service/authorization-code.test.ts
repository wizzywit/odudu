import { describe, expect, it } from 'vitest';
import {
  generateAuthorizationCode,
  hashAuthorizationCode,
  isAuthorizationCodeExpired,
} from '#/service/authorization-code';

// Not tagged with a coverage id: no RFC6749 §10.10 row is scoped to
// authorization codes alone (its "generated credential" language spans
// access tokens, refresh tokens and passwords too), and claiming that row
// covered on the strength of this test alone would overstate what it
// proves.
describe('the authorization code is opaque and stored hashed', () => {
  it('returns a high-entropy code', () => {
    const code = generateAuthorizationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('returns a different code every time', () => {
    expect(generateAuthorizationCode()).not.toEqual(generateAuthorizationCode());
  });

  it('hashes the code so the stored value cannot be replayed', () => {
    const code = generateAuthorizationCode();
    const hash = hashAuthorizationCode(code);
    expect(hash).not.toContain(code);
    expect(hashAuthorizationCode(code)).toEqual(hash);
  });
});

describe('[RFC6749-4.1.2-03] a granted authorization code expires shortly after issuance', () => {
  it('is not expired the instant it is issued', () => {
    const authTime = new Date('2026-01-01T00:00:00.000Z');
    expect(isAuthorizationCodeExpired(new Date(authTime.getTime() + 60_000), authTime)).toBe(false);
  });

  it('is expired once its expiry instant has passed', () => {
    const expiresAt = new Date('2026-01-01T00:01:00.000Z');
    expect(isAuthorizationCodeExpired(expiresAt, new Date(expiresAt.getTime() + 1))).toBe(true);
  });

  it('is expired at the exact expiry instant', () => {
    const expiresAt = new Date('2026-01-01T00:01:00.000Z');
    expect(isAuthorizationCodeExpired(expiresAt, expiresAt)).toBe(true);
  });
});
