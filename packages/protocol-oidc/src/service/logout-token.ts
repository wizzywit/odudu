import { newId } from '@odudu/kernel';

// Back-Channel Logout §2.4. `typ` is what a signing call site (a future
// `signJwt(claims, { key, kek, typ: LOGOUT_TOKEN_TYP })`) puts in the JWT
// header — this module only assembles the payload.
export const LOGOUT_TOKEN_TYP = 'logout+jwt';

// §4: "preferably at most two minutes." The token is minted at the moment
// the session ends, so this bounds the window before a slow delivery
// attempt would carry a stale one.
export const LOGOUT_TOKEN_LIFETIME_SECONDS = 120;

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export interface LogoutTokenInput {
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly now: Date;
}

// Closed deliberately: no index signature. §2.4 is as much about what a
// Logout Token must not carry as what it must, so excess-property checking
// stays on. A caller handing this to `signJwt` (whose `jose` payload type
// does carry an index signature) spreads it into a fresh object literal —
// `signJwt({ ...claims }, opts)` — which type-checks without loosening this
// type itself.
export interface LogoutTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly sub: string;
  readonly sid: string;
  readonly events: Readonly<Record<string, Readonly<Record<string, never>>>>;
}

// §2.4: `sub` and `sid` are each individually optional but at least one is
// required — this server has both for every session-backed grant, so it
// sends both. No `nonce` is assembled here at all, which is what keeps one
// out: there is no field to carry over from an ID token's claim set.
export function logoutTokenClaims(input: LogoutTokenInput): LogoutTokenClaims {
  const iat = Math.floor(input.now.getTime() / 1000);
  return {
    iss: input.issuer,
    aud: input.audience,
    iat,
    exp: iat + LOGOUT_TOKEN_LIFETIME_SECONDS,
    jti: newId(),
    sub: input.subject,
    sid: input.sessionId,
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// A stored Logout Token's claims for one delivery attempt: another issuer, for
// the tenant's address as it is now rather than as it was when the session
// ended, and an `iat` and `exp` of the attempt with the lifetime the token was
// minted with, so a retry is not refused for the age of the first try. The
// `jti` is kept: it is the same event. Null for anything that is not a token
// this module assembled.
export function reissuedLogoutTokenClaims(
  token: string,
  issuer: string,
  now: Date,
): LogoutTokenClaims | null {
  const segment = token.split('.')[1];
  if (segment === undefined) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { aud, iat, exp, jti, sub, sid } = payload as Record<string, unknown>;
  if (
    !isNonEmptyString(aud) ||
    !isNonEmptyString(jti) ||
    !isNonEmptyString(sub) ||
    !isNonEmptyString(sid) ||
    typeof iat !== 'number' ||
    typeof exp !== 'number'
  ) {
    return null;
  }
  const attempt = Math.floor(now.getTime() / 1000);
  return {
    iss: issuer,
    aud,
    iat: attempt,
    exp: attempt + Math.max(exp - iat, 0),
    jti,
    sub,
    sid,
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
  };
}
