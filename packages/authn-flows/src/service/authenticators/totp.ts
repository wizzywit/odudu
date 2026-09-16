import { verifyTotp } from '@odudu/crypto';
import { type CredentialSecret } from '@odudu/domain-identity';

export type TotpSecret = Extract<CredentialSecret, { kind: 'totp' }>;

export interface TotpInput {
  code?: string;
}

// What the caller (usecase/executor) already looked up, before this function
// runs — this stays a leaf: no `tx`, no repository, no cross-package call.
// `subjectId` is the subject the authentication attempt is already bound to,
// and `secret` that subject's stored TOTP credential, null when there is
// none. `now` is the caller's clock, never read here.
export interface TotpVerification {
  subjectId: string | null;
  secret: TotpSecret | null;
  now: Date;
}

// `step` is the time step the accepted code belongs to. RFC 6238 §5.2
// forbids accepting the same OTP twice, and `verifyTotp` holds only half of
// that — refusing a step at or below the credential's `lastStep`. Storing
// this as the next `lastStep` is the other half, and it is why a success
// here says more than `AuthenticatorResult` can.
export type TotpStepOutcome =
  | { kind: 'success'; subjectId: string; step: number }
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };

export function totpStep(input: TotpInput, verification: TotpVerification): TotpStepOutcome {
  if (input.code === undefined) {
    return { kind: 'challenge', form: 'otp' };
  }

  const { subjectId, secret } = verification;
  if (subjectId === null || secret === null) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }

  const verified = verifyTotp({
    secret: secret.secret,
    code: input.code,
    now: verification.now,
    lastStep: secret.lastStep,
  });

  return verified.ok
    ? { kind: 'success', subjectId, step: verified.step }
    : { kind: 'failure', reason: 'invalid_credentials' };
}

// What an authenticator app scans (the otpauth:// URI Google Authenticator
// introduced and every app since has followed). The label is
// "issuer:account" and the issuer is repeated as a parameter, which is what
// stops two realms' entries for the same username colliding in the app.
export function totpEnrolmentUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// A base32 secret as generateTotpSecret produces it — checked before it
// reaches the codec, which raises on any other character, and before it can
// be stored as a credential nobody's app could ever match.
const BASE32_SECRET = /^[A-Z2-7]{16,128}$/u;

export function isTotpSecretShape(candidate: string): boolean {
  return BASE32_SECRET.test(candidate);
}

// Whether a second factor is part of this subject's sign-in at all. An
// enrolled credential is always used — a realm cannot silently stop
// honouring a factor somebody set up — and a realm that requires one
// applies to everybody, including the not-yet-enrolled, who reach it
// through the configure-totp required action rather than by being asked
// for a code they cannot produce.
export function otpApplicable(
  subject: { hasTotp: boolean },
  realm: { otpRequired: boolean },
): boolean {
  return subject.hasTotp || realm.otpRequired;
}
