import { PRIVATE_JWK_MEMBERS } from '@odudu/crypto';

const PRIVATE_MEMBERS: ReadonlySet<string> = new Set(PRIVATE_JWK_MEMBERS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored `jwks` with every private member dropped, and the index of each
 * key that carried one. Client metadata validation refuses a private member
 * now, but a row written before it did may still hold one, and nothing this
 * API serves or writes back may repeat it.
 */
export function publicJwks(jwks: unknown): { value: unknown; strippedKeys: number[] } {
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) return { value: jwks, strippedKeys: [] };
  const strippedKeys: number[] = [];
  const keys = jwks.keys.map((key: unknown, index) => {
    if (!isRecord(key)) return key;
    const kept = Object.fromEntries(
      Object.entries(key).filter(([member]) => !PRIVATE_MEMBERS.has(member)),
    );
    if (Object.keys(kept).length !== Object.keys(key).length) strippedKeys.push(index);
    return kept;
  });
  return { value: { ...jwks, keys }, strippedKeys };
}
