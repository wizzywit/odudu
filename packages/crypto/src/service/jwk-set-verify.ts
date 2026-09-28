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

// Verifies a JWT against a raw JWK Set: RFC 7523 §2.2 `private_key_jwt`,
// where the client may register any algorithm, and an ID token check that
// knows the algorithms it accepts. `algorithms` omitted leaves that to
// jose's default, which still refuses `alg: none` against a JWK Set. `null`
// covers a JWK Set with the wrong shape, no matching kid/alg, a disallowed
// algorithm, or a bad signature, issuer, audience or expiry — a caller
// reading claims must never see a partial result.
export async function verifyJwtClaims(
  token: string,
  jwks: unknown,
  opts: {
    issuer: string;
    audience: string;
    now: Date;
    algorithms?: readonly ('RS256' | 'ES256')[];
  },
): Promise<Record<string, unknown> | null> {
  if (!isJwkSet(jwks)) return null;
  try {
    const keySet = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, keySet, {
      issuer: opts.issuer,
      audience: opts.audience,
      currentDate: opts.now,
      ...(opts.algorithms ? { algorithms: [...opts.algorithms] } : {}),
    });
    return payload;
  } catch {
    return null;
  }
}

export async function verifyJwtAgainstJwkSet(
  token: string,
  jwks: unknown,
  opts: { issuer: string; audience: string; now: Date },
): Promise<boolean> {
  return (await verifyJwtClaims(token, jwks, opts)) !== null;
}
