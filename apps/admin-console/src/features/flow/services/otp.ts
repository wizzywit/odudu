import type { Step } from '#/features/flow/services/steps';
import { OTP } from '#/features/flow/services/requirement';

export const OTP_TITLE = 'One-time password';

export const OTP_LABEL = 'Ask every subject for a one-time password';

export const OTP_RULE =
  'The one-time password step is asked of a subject who has set up an authenticator app. Turn this on to ask it of every subject, those who have not set one up included. A sign-in with a passkey is never asked again.';

export function otpRequired(settings: Readonly<Record<string, unknown>>): boolean {
  return settings.otp_required === true;
}

export function otpReading(required: boolean): string {
  return required
    ? 'Asked of every subject.'
    : 'Asked only of subjects who set up an authenticator app.';
}

export const OTP_FIELD_LABEL = 'Ask every subject';

export function describeOtp(value: unknown): string {
  return value === true ? 'asked of every subject' : 'asked of those who set one up';
}

export function hasOtpStep(steps: readonly Step[]): boolean {
  return steps.some((step) => step.authenticator === OTP);
}

export const NO_OTP_STEP =
  'The flow has no one-time password step, so this has no effect until one is added.';

export const OTP_UNREAD =
  'The one-time password setting could not be loaded, so it is not offered here. The steps above can still be saved.';
