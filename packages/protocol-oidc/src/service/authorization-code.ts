import { createHash, randomBytes } from 'node:crypto';

// 32 random bytes, base64url-encoded to 43 characters: 256 bits of entropy,
// comfortably above what RFC 6749 §10.10 wants for a value that must not be
// guessable.
export function generateAuthorizationCode(): string {
  return randomBytes(32).toString('base64url');
}

// Not a slow/comparison-safe hash: the input already carries 256 bits of
// entropy, so this exists only to keep the raw code out of storage (a
// backup, a log, or a SQL injection elsewhere yields nothing redeemable),
// not to survive a brute-force search over a small keyspace.
export function hashAuthorizationCode(code: string): string {
  return createHash('sha256').update(code).digest('base64url');
}
