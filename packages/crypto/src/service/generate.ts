import { newId } from '@odudu/kernel';
import { exportJWK, generateKeyPair } from 'jose';
import { wrapPrivateJwk } from '#/service/kek';

export interface GeneratedSigningKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  publicJwk: Record<string, unknown>;
  privateJwkEncrypted: string;
}

// RSA-2048 is jose's default modulus length for RS256; ES256 always uses
// P-256. Neither has a tunable worth exposing here.
export async function generateSigningKey(
  alg: 'RS256' | 'ES256',
  kek: Uint8Array,
): Promise<GeneratedSigningKey> {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  const privateJwk = (await exportJWK(privateKey)) as Record<string, unknown>;

  return {
    kid: newId(),
    alg,
    publicJwk,
    privateJwkEncrypted: wrapPrivateJwk(privateJwk, kek),
  };
}
