import {
  importJWK,
  jwtVerify,
  SignJWT,
  UnsecuredJWT,
  type JWTHeaderParameters,
  type JWTPayload,
} from 'jose';
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

// RFC 7519 §6's Unsecured JWT: `alg: "none"`, no `kid` (there is no key),
// and no signature segment. OIDC Registration §2 makes the JWT
// serialization conditional only on `userinfo_signed_response_alg` being
// specified at all, not on its value being a real algorithm, and OIDC
// Discovery §3 says `none` MAY be among `userinfo_signing_alg_values_
// supported` — so a client that registers `"none"` still gets a JWT, not
// the JSON case wearing three dots.
export function encodeUnsecuredJwt(payload: JWTPayload): string {
  return new UnsecuredJWT(payload).encode();
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

// RFC 7519 §4.1.3: a principal absent from a present `aud` MUST reject the
// token. A verifier naming no audience checks none, so the obligation used
// to be switched off by silence — the /userinfo mix-up that accepted
// another audience's token was one call site forgetting an optional
// option. Naming an audience is required, so a call site whose own check
// cannot be expressed as membership of one fixed string says so here
// rather than by omission. Both such call sites still check `aud`; each
// explains how beside its own call.
export const AUDIENCE_UNCHECKED = Symbol('audience unchecked');

export type ExpectedAudience = string | typeof AUDIENCE_UNCHECKED;

// RFC 9068 §2.1 gives an access token `typ: at+jwt`; an OIDC Core §2 ID
// Token carries none. A verifier naming neither inherits the confusion —
// an access token was honoured as an `id_token_hint` for exactly as long as
// this was optional. A policy is required: the `typ` that must be there, a
// `typ` that must not be, `TYP_ABSENT` (see below), or this symbol, which
// declines the check in a value a grep can find.
export const TYP_UNCHECKED = Symbol('typ unchecked');

// A reader that demands this treats *any* explicitly-typed JWT as foreign,
// including one this codebase mints later for a purpose nobody has named
// yet — a denylist of one `refused` value only ever covers the confusions
// already discovered (`{refused: 'at+jwt'}` did not, and could not, cover
// `userinfo+jwt`; see docs/protocols/oidc-core.md's reading note).
export const TYP_ABSENT = Symbol('typ must be absent');

export type ExpectedTyp = string | { refused: string } | typeof TYP_UNCHECKED | typeof TYP_ABSENT;

function checkTyp(headerTyp: unknown, expected: ExpectedTyp): void {
  if (expected === TYP_UNCHECKED) return;

  if (expected === TYP_ABSENT) {
    if (headerTyp !== undefined) {
      throw new OduduError(
        'jwt_typ_mismatch',
        `typ ${JSON.stringify(headerTyp)} is not accepted here`,
      );
    }
    return;
  }

  if (typeof expected === 'string') {
    if (headerTyp !== expected) {
      throw new OduduError(
        'jwt_typ_mismatch',
        `Expected typ ${expected}, got ${String(headerTyp)}`,
      );
    }
    return;
  }

  if (headerTyp === expected.refused) {
    throw new OduduError('jwt_typ_mismatch', `typ ${expected.refused} is not accepted here`);
  }
}

export async function verifyJwt(
  token: string,
  opts: {
    keys: SigningKeyRecord[];
    issuer: string;
    audience: ExpectedAudience;
    typ: ExpectedTyp;
  },
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

  checkTyp(header.typ, opts.typ);

  const publicKey = await importJWK(record.publicJwk, record.alg);
  // `exp` REQUIRED (RFC 7519 §4.1.4; OIDC Core §2 for an ID Token
  // specifically) — `jwtVerify` only validates one that is present, so an
  // omitted `exp` verifies as a non-expiring token unless this is named.
  // Every JWT this server mints for a caller of `verifyJwt` carries one; a
  // response this server signs but does not mint as a token (a signed
  // UserInfo response) does not, and must not verify here as if it did.
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [record.alg],
    issuer: opts.issuer,
    requiredClaims: ['exp'],
    ...(typeof opts.audience === 'string' ? { audience: opts.audience } : {}),
  });

  return payload;
}
