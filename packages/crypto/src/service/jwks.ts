// The private/symmetric JWK members no published key may ever carry.
// Exported so every place that asserts this (this package's own tests, and
// protocol-oidc's wire-level JWKS test) checks against one list rather than
// each retyping it out of sync.
export const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'] as const;

// An allowlist, not a denylist: a key type added later must be taught to this
// function explicitly rather than having its private members published by
// default.
const PUBLIC_MEMBERS: Record<string, readonly string[]> = {
  RSA: ['kty', 'n', 'e'],
  EC: ['kty', 'crv', 'x', 'y'],
  OKP: ['kty', 'crv', 'x'],
};

export function toPublicJwk(
  jwk: Record<string, unknown>,
  kid: string,
  alg: string,
): Record<string, unknown> {
  const allowed = PUBLIC_MEMBERS[String(jwk.kty)];
  if (!allowed) throw new Error(`Unsupported key type ${String(jwk.kty)}`);

  const out: Record<string, unknown> = {};
  for (const member of allowed) if (member in jwk) out[member] = jwk[member];
  return { ...out, kid, alg, use: 'sig' };
}

export function assembleJwks(
  keys: { kid: string; alg: string; publicJwk: Record<string, unknown> }[],
): { keys: Record<string, unknown>[] } {
  return { keys: keys.map((k) => toPublicJwk(k.publicJwk, k.kid, k.alg)) };
}
