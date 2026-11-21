import type { ClientAuth, PrivateKeyJwk } from '#/types';

// Compiled by `tsc`, never run: the key `crypto.subtle.exportKey('jwk', key)`
// returns is accepted as a private key without a cast.
export async function exportedKey(
  key: Parameters<typeof crypto.subtle.exportKey>[1],
): Promise<ClientAuth> {
  const jwk: PrivateKeyJwk = await crypto.subtle.exportKey('jwk', key);
  return { privateKey: jwk };
}

export const literal: PrivateKeyJwk = { kty: 'EC', crv: 'P-256', d: 'x', x: 'y', y: 'z' };
