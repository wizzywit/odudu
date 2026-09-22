import { createLocalJWKSet, jwtVerify } from 'jose';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A JWK Set fetched from a jwks_uri, or stored inline at registration, is
// `unknown` at every boundary that carries it (schema/client-oidc-config.ts:
// "narrowed with Zod at the point of use, not typed here"). This is that
// narrowing: shape only, before jose ever sees it — a document that isn't
// `{ keys: [...] }` is refused the same way a document with no matching key
// is, never with a different error.
function isJwkSet(value: unknown): value is { keys: Record<string, unknown>[] } {
  if (!isRecord(value)) return false;
  return Array.isArray(value.keys) && value.keys.every(isRecord);
}

// Verifies a JWT against a raw JWK Set rather than against this tenant's own
// signing keys — the shape RFC 7523 §2.2 `private_key_jwt` needs, where the
// verifying key belongs to the client, not to Odudu. `false` covers every
// way this can fail: the value handed in is not a JWK Set, no key in it
// matches the token's kid/alg, or the signature, issuer, audience or
// expiry is wrong — one outcome, because the caller
// (protocol-oidc's client assertion authentication) must answer identically
// whichever it was.
export async function verifyJwtAgainstJwkSet(
  token: string,
  jwks: unknown,
  opts: { issuer: string; audience: string; now: Date },
): Promise<boolean> {
  if (!isJwkSet(jwks)) return false;
  try {
    const keySet = createLocalJWKSet(jwks);
    await jwtVerify(token, keySet, {
      issuer: opts.issuer,
      audience: opts.audience,
      currentDate: opts.now,
    });
    return true;
  } catch {
    return false;
  }
}
