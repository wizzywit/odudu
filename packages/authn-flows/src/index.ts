// `__Host-` requires Secure, and a browser rejects the whole cookie without
// it, so the compose stack's plain HTTP would silently break every local
// login. The name therefore follows TLS, and the fallback is announced at
// boot rather than shipping quietly — ADR 0020, which also lists the
// attributes the login handler must set alongside the name.
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
  consumeAuthenticationSession,
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
