import { CompactEncrypt, importJWK, type CompactJWEHeaderParameters, type JWK } from 'jose';
import { OduduError } from '@odudu/kernel';

// docs/superpowers/p3b-spike-jwe.md: the only alg/enc pairs the installed
// `jose` produces against a client-published asymmetric key. `RSA1_5` is
// removed from the library; `RSA-OAEP` verifies only against a key
// generated specifically for it, which a bare client JWK cannot promise.
// A later task narrows client registration to this same set rather than
// keeping a second literal that can drift from it.
export const JWE_ALGS_PERMITTED = [
  'RSA-OAEP-256',
  'ECDH-ES',
  'ECDH-ES+A128KW',
  'ECDH-ES+A192KW',
  'ECDH-ES+A256KW',
] as const;

export type JweAlg = (typeof JWE_ALGS_PERMITTED)[number];

const JWE_ALGS = new Set<string>(JWE_ALGS_PERMITTED);

const ENCRYPTION_KEY_OPS = new Set(['encrypt', 'wrapKey', 'deriveKey', 'deriveBits']);

export async function encryptCompact(
  payload: string,
  key: JWK,
  alg: string,
  enc: string,
  opts: { nested?: boolean } = {},
): Promise<string> {
  if (!JWE_ALGS.has(alg)) {
    throw new OduduError('jwe_alg_unsupported', `${alg} is not a permitted JWE alg`);
  }

  const publicKey = await importJWK(key, alg);

  const header: CompactJWEHeaderParameters = { alg, enc };
  if (opts.nested === true) header.cty = 'JWT';

  return new CompactEncrypt(new TextEncoder().encode(payload))
    .setProtectedHeader(header)
    .encrypt(publicKey);
}

function ktyMatchesAlgFamily(jwk: Record<string, unknown>, alg: string): boolean {
  if (alg.startsWith('RSA-')) return jwk.kty === 'RSA';
  if (alg.startsWith('ECDH-ES')) {
    if (jwk.kty === 'EC') return true;
    // OKP also holds Ed25519 signing keys; X448 is JWA-assigned but
    // unimplemented by this `jose` (spike, "A key with no use and no alg").
    return jwk.kty === 'OKP' && jwk.crv === 'X25519';
  }
  return false;
}

function isEncryptionCandidate(value: unknown, alg: string): value is JWK {
  if (typeof value !== 'object' || value === null) return false;
  const jwk = value as Record<string, unknown>;

  if (jwk.use !== undefined && jwk.use !== 'enc') return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (Array.isArray(jwk.key_ops) && !jwk.key_ops.some((op) => ENCRYPTION_KEY_OPS.has(String(op)))) {
    return false;
  }

  return ktyMatchesAlgFamily(jwk, alg);
}

export function selectEncryptionKey(jwks: { keys: unknown[] }, alg: string): JWK | null {
  const [only, ...rest] = jwks.keys.filter((k) => isEncryptionCandidate(k, alg));
  return only !== undefined && rest.length === 0 ? only : null;
}
