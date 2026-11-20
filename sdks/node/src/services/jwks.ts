import type { JWK } from 'jose';
import { MAX_KEYS_PER_ISSUER } from '#/services/key-cache';

export const SIGNING_ALGORITHMS = ['RS256', 'ES256'] as const;
export type SigningAlgorithm = (typeof SIGNING_ALGORITHMS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A key the SDK may verify with: public, for signing, of a kind the server
// signs with, and named. Anything else in the set is ignored rather than
// failing the whole set.
function isUsable(key: unknown): key is JWK & { kid: string } {
  if (!isRecord(key) || typeof key.kid !== 'string' || key.kid === '') return false;
  if (key.kty !== 'RSA' && key.kty !== 'EC') return false;
  if ('d' in key || (key.use !== undefined && key.use !== 'sig')) return false;
  return key.alg === undefined || (SIGNING_ALGORITHMS as readonly unknown[]).includes(key.alg);
}

// The usable keys of a JWK Set document by `kid`, the first 20 of them.
export function keysByKid(document: unknown): Map<string, JWK> | undefined {
  if (!isRecord(document) || !Array.isArray(document.keys)) return undefined;
  const keys = new Map<string, JWK>();
  for (const key of document.keys as unknown[]) {
    if (isUsable(key) && !keys.has(key.kid) && keys.size < MAX_KEYS_PER_ISSUER) {
      keys.set(key.kid, key);
    }
  }
  return keys;
}
