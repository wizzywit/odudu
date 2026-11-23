// An access-token check written the way an API author would write it with jose
// alone, as examples/api/server.ts does. It imports nothing from src/: it is
// the second opinion the SDK is held against. Every rule here is the server's.
import { readFileSync } from 'node:fs';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

export interface ReferenceOptions {
  issuer: string;
  audience: string;
  requiredScope?: string;
  // Milliseconds since the epoch.
  now: number;
}

export type ReferenceVerdict = { ok: true } | { ok: false; status: 401 | 403 };

const jwks = JSON.parse(
  readFileSync(new URL('./fixtures/jwks.json', import.meta.url), 'utf8'),
) as Parameters<typeof createLocalJWKSet>[0];
const keys = createLocalJWKSet(jwks);

const REFUSED: ReferenceVerdict = { ok: false, status: 401 };

// The server compares `typ` exactly (packages/crypto sign.ts checkTyp); jose's
// own `typ` option would accept `AT+JWT`.
function headerIsAcceptable(token: string): boolean {
  const header = decodeProtectedHeader(token);
  return (
    header.typ === 'at+jwt' &&
    (header.alg === 'RS256' || header.alg === 'ES256') &&
    typeof header.kid === 'string'
  );
}

// kernel's namesMeAudience: the audience of the signed-in person's own account.
function namesMeAudience(payload: JWTPayload, issuer: string): boolean {
  const named = typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? []);
  return named.includes(`${issuer}/me`);
}

export async function verifyWithReference(
  token: string,
  options: ReferenceOptions,
): Promise<ReferenceVerdict> {
  let payload: JWTPayload;
  try {
    if (!headerIsAcceptable(token)) return REFUSED;
    ({ payload } = await jwtVerify(token, keys, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['RS256', 'ES256'],
      clockTolerance: 5,
      currentDate: new Date(options.now),
      requiredClaims: ['exp', 'sub'],
    }));
  } catch {
    return REFUSED;
  }
  if (namesMeAudience(payload, options.issuer)) return REFUSED;
  const granted = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
  if (options.requiredScope !== undefined && !granted.includes(options.requiredScope)) {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}
