import { createHash, createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { StdioError } from '#/services/stdio-error';

export const CLIENT_KEY_ALG = 'ES256';

export interface ClientKey {
  readonly kid: string;
  readonly privateJwk: Record<string, unknown>;
  readonly publicJwk: Record<string, unknown>;
}

function invalid(): StdioError {
  return new StdioError(
    'mcp_key_invalid',
    'the service account key is not a key made by odudu mcp --keygen',
  );
}

// RFC 7638: the SHA-256 of the key's required members in lexicographic order.
function thumbprint(x: string, y: string): string {
  const canonical = `{"crv":"P-256","kty":"EC","x":${JSON.stringify(x)},"y":${JSON.stringify(y)}}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

function publicHalf(x: string, y: string): { jwk: Record<string, unknown>; kid: string } {
  const kid = thumbprint(x, y);
  return { kid, jwk: { kty: 'EC', crv: 'P-256', x, y, kid, alg: CLIENT_KEY_ALG, use: 'sig' } };
}

/** A new signing key in the form the environment holds: its private JWK, base64-encoded. */
export function generateClientKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  if (jwk.x === undefined || jwk.y === undefined) throw invalid();
  const { kid } = publicHalf(jwk.x, jwk.y);
  const serialized = JSON.stringify({ ...jwk, kid, alg: CLIENT_KEY_ALG, use: 'sig' });
  return Buffer.from(serialized, 'utf8').toString('base64');
}

// The kid is the key's thumbprint, never what the value claims, so the
// registered key set and the assertion header cannot disagree about it.
export function loadClientKey(serialized: string): ClientKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(serialized, 'base64').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid();
  const jwk = parsed as Record<string, unknown>;
  const { x, y, d } = jwk;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw invalid();
  if (typeof x !== 'string' || typeof y !== 'string' || typeof d !== 'string') throw invalid();
  try {
    createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d }, format: 'jwk' });
  } catch {
    throw invalid();
  }
  const { jwk: publicJwk, kid } = publicHalf(x, y);
  return {
    kid,
    privateJwk: { kty: 'EC', crv: 'P-256', x, y, d, kid, alg: CLIENT_KEY_ALG, use: 'sig' },
    publicJwk,
  };
}
