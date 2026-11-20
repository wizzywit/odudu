import {
  decodeJwt,
  decodeProtectedHeader,
  errors,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import { SIGNING_ALGORITHMS, type SigningAlgorithm } from '#/services/jwks';
import { VerificationError } from '#/services/verification-error';
import type { VerifiedToken } from '#/types';

// RFC 9068 §4 allows `at+jwt` and `application/at+jwt` and RFC 7515 §4.1.9
// makes the media type case-insensitive. The server compares the header with
// `at+jwt` exactly and refuses the rest, and so does this.
const ACCESS_TOKEN_TYPE = 'at+jwt';
// Seconds of leeway on `exp` and `nbf`.
export const CLOCK_TOLERANCE_SECONDS = 5;

export interface TokenHeader {
  alg: SigningAlgorithm;
  kid: string;
}

// The issuer a token claims, read before anything is trusted. It only selects
// among the configured issuers: it is never fetched or used as an address.
export function claimedIssuer(token: string, issuers: readonly string[]): string {
  let iss: unknown;
  try {
    iss = decodeJwt(token).iss;
  } catch {
    throw new VerificationError('malformed');
  }
  const configured = issuers.find((issuer) => issuer === iss);
  if (configured === undefined) throw new VerificationError('wrong_issuer');
  return configured;
}

function isSigningAlgorithm(alg: unknown): alg is SigningAlgorithm {
  return (SIGNING_ALGORITHMS as readonly unknown[]).includes(alg);
}

// The checks that need no key: the token is an access token, signed with an
// algorithm the server uses (so `none` and any HMAC are refused before a key
// is looked up) and names the key it was signed with.
export function checkHeader(token: string): TokenHeader {
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new VerificationError('malformed');
  }
  if (header.typ !== ACCESS_TOKEN_TYPE) throw new VerificationError('wrong_type');
  const { alg, kid } = header;
  if (!isSigningAlgorithm(alg)) throw new VerificationError('unsupported_algorithm');
  if (typeof kid !== 'string' || kid === '') throw new VerificationError('invalid_header');
  return { alg, kid };
}

function failure(error: unknown): VerificationError {
  if (error instanceof errors.JWTExpired) return new VerificationError('expired');
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'nbf') return new VerificationError('not_yet_valid');
    if (error.claim === 'aud') return new VerificationError('wrong_audience');
    if (error.claim === 'iss') return new VerificationError('wrong_issuer');
    return new VerificationError('invalid_claims');
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return new VerificationError('bad_signature');
  }
  return new VerificationError('malformed');
}

export async function verifySigned(
  token: string,
  jwk: JWK,
  header: TokenHeader,
  expected: { issuer: string; audience: string; nowMs: number },
): Promise<JWTPayload> {
  if (jwk.alg !== undefined && jwk.alg !== header.alg) {
    throw new VerificationError('unsupported_algorithm');
  }
  try {
    const key = await importJWK(jwk, header.alg);
    const { payload } = await jwtVerify(token, key, {
      algorithms: [header.alg],
      issuer: expected.issuer,
      audience: expected.audience,
      requiredClaims: ['exp'],
      currentDate: new Date(expected.nowMs),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    return payload;
  } catch (error) {
    throw failure(error);
  }
}

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : [];

// The "me" API's audience is the issuer's address plus `/me`. A token for it
// names it beside its issuer; an API that is not that one refuses any token
// that names it, as the server does at every door but the "me" API.
function namesMeAudience(audience: readonly string[], issuers: readonly string[]): boolean {
  return issuers.some((issuer) => audience.includes(`${issuer}/me`));
}

// What the verified claims say, once they are known to be well formed.
export function readClaims(
  payload: JWTPayload,
  issuers: readonly string[],
  requiredScope: string | undefined,
): VerifiedToken {
  const audience = strings(payload.aud);
  if (namesMeAudience(audience, issuers)) throw new VerificationError('me_audience');
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new VerificationError('invalid_claims');
  }
  if (payload.scope !== undefined && typeof payload.scope !== 'string') {
    throw new VerificationError('invalid_claims');
  }
  const scope = (payload.scope ?? '').split(' ').filter((s) => s !== '');
  if (requiredScope !== undefined && !scope.includes(requiredScope)) {
    throw new VerificationError('insufficient_scope', requiredScope);
  }
  return {
    sub: payload.sub,
    clientId: typeof payload.client_id === 'string' ? payload.client_id : undefined,
    scope,
    audience,
    claims: { ...payload },
  };
}
