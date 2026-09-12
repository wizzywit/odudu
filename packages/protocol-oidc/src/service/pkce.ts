import { createHash, timingSafeEqual } from 'node:crypto';

// RFC 7636 §4.1 and §4.2 give the verifier and the challenge the same
// shape — 43 to 128 characters of unreserved ASCII — so they share one
// definition rather than two that can drift. §4.2's challenge is the
// base64url encoding of a SHA-256 digest, which is 43 of those characters.
const PKCE_STRING_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isWellFormedPkceString(value: string): boolean {
  return PKCE_STRING_PATTERN.test(value);
}

// `plain` is never accepted (RFC 7636 §4.2/§4.3), so `S256` is the only key
// this ever needs — kept as a lookup, not a literal `createHash('sha256')`
// call, so `method` stays load-bearing rather than an inert parameter the
// type system has already narrowed to one value.
const HASH_ALGORITHM: Record<'S256', 'sha256'> = { S256: 'sha256' };

// RFC 7636 §4.6: transform the verifier with the method bound to the code
// (never one supplied fresh on the token request) and compare against the
// stored challenge. Constant-time: this is a secret-bearing comparison, not
// a lookup key, so a data-dependent early exit would leak timing.
export function verifyPkce(verifier: string, challenge: string, method: 'S256'): boolean {
  if (!isWellFormedPkceString(verifier)) return false;

  const computed = createHash(HASH_ALGORITHM[method]).update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
