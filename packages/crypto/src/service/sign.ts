import { importJWK, jwtVerify, SignJWT, type JWTHeaderParameters, type JWTPayload } from 'jose';
import { OduduError } from '@odudu/kernel';
import { unwrapPrivateJwk } from '#/service/kek';
import { type SigningKeyRecord } from '#/schema/signing-keys';

export async function signJwt(
  payload: JWTPayload,
  opts: { key: SigningKeyRecord; kek: Uint8Array; typ?: string },
): Promise<string> {
  const jwk = unwrapPrivateJwk<Record<string, unknown>>(opts.key.privateJwkEncrypted, opts.kek);
  const privateKey = await importJWK(jwk, opts.key.alg);

  const header: JWTHeaderParameters = { alg: opts.key.alg, kid: opts.key.kid };
  if (opts.typ !== undefined) header.typ = opts.typ;

  return new SignJWT(payload).setProtectedHeader(header).sign(privateKey);
}

function decodeProtectedHeaderSafely(token: string): Record<string, unknown> {
  const segment = token.split('.')[0];
  if (segment === undefined || segment.length === 0) {
    throw new OduduError('jwt_header_invalid', 'Token carries no header segment');
  }

  let json: string;
  try {
    json = Buffer.from(segment, 'base64url').toString('utf8');
  } catch (cause) {
    throw new OduduError('jwt_header_invalid', 'Token header is not valid base64url', { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new OduduError('jwt_header_invalid', 'Token header is not valid JSON', { cause });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OduduError('jwt_header_invalid', 'Token header is not a JSON object');
  }

  return parsed as Record<string, unknown>;
}

export async function verifyJwt(
  token: string,
  opts: { keys: SigningKeyRecord[]; issuer: string; audience?: string; typ?: string },
): Promise<JWTPayload> {
  const header = decodeProtectedHeaderSafely(token);

  if (typeof header.kid !== 'string' || header.kid.length === 0) {
    throw new OduduError('jwt_kid_missing', 'Token carries no kid');
  }

  // kid is attacker-controlled text. It is matched exactly against the
  // records handed in and never becomes a path, a query fragment, or a
  // cache key.
  const record = opts.keys.find((k) => k.kid === header.kid);
  if (!record) throw new OduduError('jwt_unknown_key', `Unknown key ${header.kid}`);

  if (header.alg !== record.alg) {
    throw new OduduError(
      'jwt_alg_mismatch',
      `Header alg ${String(header.alg)} is not the key's ${record.alg}`,
    );
  }

  if (opts.typ !== undefined && header.typ !== opts.typ) {
    throw new OduduError('jwt_typ_mismatch', `Expected typ ${opts.typ}, got ${String(header.typ)}`);
  }

  const publicKey = await importJWK(record.publicJwk, record.alg);
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [record.alg],
    issuer: opts.issuer,
    ...(opts.audience === undefined ? {} : { audience: opts.audience }),
  });

  return payload;
}
