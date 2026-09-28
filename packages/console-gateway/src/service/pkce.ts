import { createHash, randomBytes } from 'node:crypto';

// RFC 7636 §4.1: 32 random octets, base64url-encoded, are 43 characters of
// the unreserved set.
export function codeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
