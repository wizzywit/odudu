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
  initialChallenge,
  pendingChallenge,
  consumeAuthenticationSession,
  establishSession,
  resetAuthenticationProgress,
  type AdvanceInput,
  type AdvanceOptions,
  type AdvanceOutcome,
} from '#/usecase/executor';
export {
  passwordStep,
  type PasswordInput,
  type PasswordVerification,
} from '#/service/authenticators/password';
export {
  counterAdvanced,
  passkeyStep,
  type PasskeyInput,
  type PasskeyVerification,
  type WebauthnSecret,
} from '#/service/authenticators/passkey';
export {
  otpApplicable,
  totpStep,
  type TotpInput,
  type TotpSecret,
  type TotpVerification,
} from '#/service/authenticators/totp';
export {
  beginTotpEnrolment,
  completeTotpEnrolment,
  type TotpEnrolmentOutcome,
} from '#/usecase/totp-enrolment';
export { renderTotpEnrolmentPage, type TotpEnrolmentOffer } from '#/view/totp-enrolment-html';
export {
  beginPasskeyEnrolment,
  completePasskeyEnrolment,
  type PasskeyEnrolmentOutcome,
} from '#/usecase/passkey-enrolment';
export {
  beginPasskeyAuthentication,
  type BeginPasskeyAuthentication,
} from '#/usecase/passkey-authentication';
export {
  relyingPartyId,
  relyingPartyOrigin,
  type PasskeyAuthenticationOffer,
  type PasskeyRegistrationOffer,
} from '#/service/webauthn';
export {
  renderPasskeyEnrolmentPage,
  type PasskeyEnrolmentOffer,
} from '#/view/passkey-enrolment-html';
export { authenticationSessionRepository } from '#/repository/authentication-sessions';
export { sessionRepository } from '#/repository/sessions';
export {
  authenticationSessions,
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
export { sessions, type SessionRecord } from '#/schema/sessions';
export { type AuthenticatorResult } from '#/schema/authenticator';
export { executionRepository, type NewAuthenticationExecution } from '#/repository/executions';
export {
  authenticationExecutions,
  type AuthenticationExecutionRecord,
  type Requirement,
} from '#/schema/execution';
export {
  provisionBrowserFlow,
  provisionRealm,
  BROWSER_FLOW_DEFAULT,
} from '#/usecase/provision-flow';
export { nextRequiredAction } from '#/usecase/required-actions';
export { requiredActionRepository } from '#/repository/required-actions';
export { userRequiredActions, type RequiredAction } from '#/schema/required-action';
export { renderRequiredActionPage } from '#/view/required-action-html';
