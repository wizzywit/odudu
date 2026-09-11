// Cookie naming: __Host- requires Secure, Path=/, and no
// Domain attribute — which browsers enforce by rejecting the whole cookie if
// the connection isn't HTTPS. The compose stack serves plain HTTP on :3000
// today, so always emitting __Host- would silently break every local login.
//
// Chosen: (b) — __Host-<realm>-session when TLS is on, otherwise
// <realm>-session with Secure off, plus a boot-time warning while the
// fallback is active. This keeps the production cookie shape correct from
// day one (no later migration of session cookies), keeps `pnpm dev` working
// without a local CA, and makes the weaker mode something an operator will
// notice in logs rather than something that silently ships. The alternative,
// (a) always __Host- and stand up local HTTPS now, was rejected: it moves
// TLS-provisioning work into this task for no security gain in a
// single-developer local loop that talks to itself over loopback.
//
// The OpenID conformance run must confirm this choice holds up: the suite may
// itself drive the server over plain HTTP.

// This package produces only the cookie name. Whoever sets the header — the
// login handler behind /authorize — must also set: HttpOnly (never readable
// from script), SameSite
// (Lax at minimum, to survive the top-level redirect back from /authorize),
// Path=/ (required by __Host- when TLS is on, and kept the same in the
// fallback so the two modes differ only in name and Secure), and Secure
// (only when TLS is on — see the fallback rationale above). Dropping Secure
// in the non-TLS fallback must not mean dropping the other three.
export function sessionCookieName(realm: string, tls: boolean): string {
  return tls ? `__Host-${realm}-session` : `${realm}-session`;
}

export function warnIfCookieFallbackActive(
  tls: boolean,
  log: (message: string) => void = console.warn,
): void {
  if (!tls) {
    log(
      'authn-flows: serving session cookies without the __Host- prefix because TLS is off. ' +
        'This is expected for local development only — never in production.',
    );
  }
}

export {
  startAuthentication,
  loadPendingRequest,
  advance,
  establishSession,
  type AdvanceInput,
} from '#/usecase/executor';
export {
  passwordStep,
  type PasswordInput,
  type PasswordVerification,
} from '#/service/authenticators/password';
export { authenticationSessionRepository } from '#/repository/authentication-sessions';
export { sessionRepository } from '#/repository/sessions';
export {
  authenticationSessions,
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
export { sessions, type SessionRecord } from '#/schema/sessions';
export { type AuthenticatorResult } from '#/schema/authenticator';
