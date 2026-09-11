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
