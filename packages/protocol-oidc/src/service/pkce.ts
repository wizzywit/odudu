import { createHash, timingSafeEqual } from 'node:crypto';

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

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
  if (!VERIFIER_PATTERN.test(verifier)) return false;

  const computed = createHash(HASH_ALGORITHM[method]).update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
