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

// The index signature is what lets this be handed to `signJwt`, whose
// `jose` payload type carries one; every named claim is still typed above
// it, so a caller narrows nothing to read `iss`, `sid`, and the rest.
export interface LogoutTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly sub: string;
  readonly sid: string;
  readonly events: Readonly<Record<string, Readonly<Record<string, never>>>>;
  readonly [claim: string]: unknown;
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
