import { type AuthenticationSessionRecord } from '#/schema/authentication-sessions';
import { type FlowStep } from '#/schema/flow';
import { type AuthenticatorPolicy } from '#/service/authenticator-policy';
import { OTP, PASSKEY, RECOVERY_CODE } from '#/service/authenticators/names';

function settingsOf(steps: readonly FlowStep[], authenticator: string): FlowStep['settings'] {
  return steps.find(
    (step) => step.authenticator === authenticator && step.requirement !== 'disabled',
  )?.settings;
}

// What the next enrolment is made under: the tenant's policy, with each key
// a step of the flow names put over it. A disabled step is not run, so what
// it carries is not read.
export function effectiveAuthenticatorPolicy(
  tenant: AuthenticatorPolicy,
  steps: readonly FlowStep[],
): AuthenticatorPolicy {
  const totp = settingsOf(steps, OTP);
  const passkey = settingsOf(steps, PASSKEY);
  const recovery = settingsOf(steps, RECOVERY_CODE);
  return {
    totp: {
      algorithm: totp?.algorithm ?? tenant.totp.algorithm,
      digits: totp?.digits ?? tenant.totp.digits,
      period: totp?.period ?? tenant.totp.period,
    },
    webauthn: {
      userVerification: passkey?.user_verification ?? tenant.webauthn.userVerification,
      residentKey: passkey?.resident_key ?? tenant.webauthn.residentKey,
    },
    recoveryCodeCount: recovery?.count ?? tenant.recoveryCodeCount,
  };
}

// The flow a sign-in was parked on, or null for the tenant's default: a
// session that is gone or names none follows the default.
export function flowIdOf(record: AuthenticationSessionRecord | null): string | null {
  return record?.pendingRequest.flowId ?? null;
}
