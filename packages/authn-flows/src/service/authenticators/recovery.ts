import { type CredentialSecret, verifyPassword } from '@odudu/domain-identity';
import { randomBytes } from 'node:crypto';
import { PASSKEY, RECOVERY_CODE } from '#/service/authenticators/names';

export type RecoveryCodeSecret = Extract<CredentialSecret, { kind: 'recovery-code' }>;

// Crockford's base32 set (https://www.crockford.com/base32.html): the ten
// digits plus the letters minus I, L, O and U — the three that a reader
// confuses with 1, 1 and 0, and the one that turns a random string into a
// word nobody wants printed. Exactly 32 characters, so a random byte masked
// to five bits picks one uniformly with no rejection loop.
export const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Crockford's own decoding rule, which is the point of using his alphabet:
// the excluded letters are not refused but folded onto the digits they look
// like, so a code read off paper as O5HQ1 authenticates the same as 05HQ1.
const CONFUSABLE: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

// 32^10 is 2^50 — a thousand million million codes, against ten live at a
// time, so blind guessing is hopeless even with no rate limit in front of
// it. Ten characters is also short enough to read off paper and retype,
// which a longer code stops being.
const CODE_LENGTH = 10;

// Printed with one separator so the eye can chunk it. The hyphen is not part
// of the code: normalise() drops it, so a user who types it and a user who
// does not both authenticate.
const GROUP_LENGTH = 5;

export const RECOVERY_CODE_COUNT = 10;

function alphabetChar(index: number): string {
  const char = RECOVERY_CODE_ALPHABET[index];
  if (char === undefined) {
    throw new RangeError(`recovery code alphabet index out of range: ${String(index)}`);
  }
  return char;
}

function randomCode(): string {
  let code = '';
  for (const byte of randomBytes(CODE_LENGTH)) {
    code += alphabetChar(byte & 0x1f);
  }
  return `${code.slice(0, GROUP_LENGTH)}-${code.slice(GROUP_LENGTH)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, randomCode);
}

// What a stored hash was computed over: the alphabet's own characters and
// nothing else. Lower case is folded up, O/I/L onto 0/1/1, and the
// separator, spaces and anything else a paste carries are dropped — so the
// value that reaches Argon2 is the same whichever way the code was copied.
export function normaliseRecoveryCode(submitted: string): string {
  let normalised = '';
  for (const raw of submitted.toUpperCase()) {
    const char = CONFUSABLE[raw] ?? raw;
    if (RECOVERY_CODE_ALPHABET.includes(char)) normalised += char;
  }
  return normalised;
}

export interface RecoveryInput {
  recoveryCode?: string;
}

// One of the subject's stored recovery codes: the row id, so the caller can
// spend the one that matched, and the secret it was read from.
export interface StoredRecoveryCode {
  id: string;
  secret: RecoveryCodeSecret;
}

// What the caller (usecase/executor) already looked up, before this function
// runs — this stays a leaf: no `tx`, no repository, no cross-package call.
// `subjectId` is the subject the authentication attempt is already bound to,
// and `codes` every recovery-code credential that subject holds, spent ones
// included: a spent one is refused as spent, which it cannot be if it was
// never read.
export interface RecoveryVerification {
  subjectId: string | null;
  codes: readonly StoredRecoveryCode[];
}

// `credentialId` is the row the accepted code came from. The caller has to
// spend exactly that row, and nothing else here can say which it was — the
// same reason TotpStepOutcome carries a step.
export type RecoveryStepOutcome =
  | { kind: 'success'; subjectId: string; credentialId: string }
  | { kind: 'challenge'; form: string }
  // `already_used` is deliberately distinguishable from invalid_credentials.
  // A recovery code is a second factor, so by the time one is presented the
  // attempt is already bound to a subject and the answer tells that subject
  // about their own credential — it discloses nothing to anybody else, and
  // "you already used that one" is the difference between trying the next
  // code and believing the whole list is worthless.
  | { kind: 'failure'; reason: 'invalid_credentials' | 'already_used' };

export function recoveryCodeOffered(input: RecoveryInput): boolean {
  return input.recoveryCode !== undefined && normaliseRecoveryCode(input.recoveryCode).length > 0;
}

export async function recoveryStep(
  input: RecoveryInput,
  verification: RecoveryVerification,
): Promise<RecoveryStepOutcome> {
  if (!recoveryCodeOffered(input)) {
    return { kind: 'challenge', form: RECOVERY_CODE };
  }

  const { subjectId } = verification;
  if (subjectId === null) return { kind: 'failure', reason: 'invalid_credentials' };

  const submitted = normaliseRecoveryCode(input.recoveryCode ?? '');
  // Sequential, and stopping at the first match: every comparison is a full
  // Argon2id verification, so ten in parallel would hold the whole thread
  // pool for the duration of one login attempt.
  for (const stored of verification.codes) {
    if (!(await verifyPassword(stored.secret.hash, submitted))) continue;
    if (stored.secret.usedAt !== undefined) return { kind: 'failure', reason: 'already_used' };
    return { kind: 'success', subjectId, credentialId: stored.id };
  }
  return { kind: 'failure', reason: 'invalid_credentials' };
}

// Whether a recovery code can stand in for the second factor on this
// attempt. `offered` is what keeps it out of the way the rest of the time:
// the step it substitutes for is the one that would otherwise run, so it
// applies only to a submission that actually carries a code — the same
// reason a passkey applies only to one that carries an assertion.
export function recoveryApplicable(
  subject: { hasRecoveryCodes: boolean },
  offered: boolean,
  secondFactorInPlay: boolean,
  satisfied: ReadonlySet<string>,
): boolean {
  // Never after a passkey, for the reason otpApplicable gives: an assertion
  // is already two factors, so there is no second factor left to recover.
  if (satisfied.has(PASSKEY)) return false;
  return offered && subject.hasRecoveryCodes && secondFactorInPlay;
}
