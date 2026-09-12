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

  // Exactly 43 base64url characters is exactly 32 bytes, which is 256 bits —
  // past both the 2^-128 RFC 6749 §10.10 requires of a generated credential
  // and the 2^-160 it recommends. Width alone does not establish that,
  // though: 8 random bytes padded out to 43 characters decode to 32 bytes
  // and match the same shape, so the width is checked here and the
  // randomness behind it is checked over a sample below.
  it('is 43 base64url characters, which is 32 bytes wide', () => {
    const code = generateAuthorizationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(code, 'base64url')).toHaveLength(32);
  });

  it('returns a different code every time', () => {
    expect(generateAuthorizationCode()).not.toEqual(generateAuthorizationCode());
  });

  // A single pair being different is satisfied by a counter. A large sample
  // with no collision at all is what a random source looks like, and is what
  // "cannot be guessed" needs underneath it.
  it('produces no repeat across a large sample', () => {
    const sample = new Set(Array.from({ length: 5_000 }, () => generateAuthorizationCode()));
    expect(sample.size).toBe(5_000);
  });

  // Structure is what a guesser exploits: a fixed prefix, padding, an
  // embedded constant, a counter in a known position. Every one of those
  // shows up as a character position that never changes, so every position
  // is checked — not the code's width, which padding restores, and not a
  // collision count, which 64 bits of randomness would also pass.
  it('varies at every character position across a sample', () => {
    const codes = Array.from({ length: 256 }, () => generateAuthorizationCode());
    const constant = Array.from({ length: 43 }, (_unused, i) => i).filter(
      (i) => new Set(codes.map((code) => code[i])).size === 1,
    );
    expect(constant).toEqual([]);
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
