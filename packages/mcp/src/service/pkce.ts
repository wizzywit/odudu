import { createHash } from 'node:crypto';

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

// RFC 7636 §4.1: 32 octets of entropy encode to the 43 unreserved characters
// the verifier's minimum length asks for. The entropy is handed in, so a test
// can fix it and the draw stays at the edge.
export function pkceFor(entropy: Uint8Array): Pkce {
  if (entropy.length < 32)
    throw new RangeError('a PKCE verifier needs at least 32 bytes of entropy');
  const verifier = Buffer.from(entropy.subarray(0, 32)).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
