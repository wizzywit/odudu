import { MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG } from '@odudu/kernel';

export interface PasswordPolicy {
  minLength: number;
  requireDigit: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireSpecial: boolean;
  notUsername: boolean;
  notEmail: boolean;
  historyDepth: number;
  maxAgeDays: number;
}

export interface PolicyViolation {
  rule: string;
  message: string;
}

export interface PasswordSubject {
  username: string;
  email: string | null;
}

// The one rule evaluatePassword cannot decide: whether the candidate is a
// password this subject has already had. That answer lives in stored
// Argon2id hashes, so it is verified where a transaction is in hand and
// reported with this — a rule of the tenant's policy either way, named here
// alongside the rest so a page renders one list.
export const REUSED_PASSWORD: PolicyViolation = {
  rule: 'not-reused',
  message: 'Password must not be one you have used before.',
};

const SPECIAL_CHARACTER = /[^A-Za-z0-9]/u;

// Every violation is collected, not just the first: a form that rejects one
// rule at a time takes as many attempts as there are rules.
export function evaluatePassword(
  candidate: string,
  policy: PasswordPolicy,
  subject: PasswordSubject,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  // Counts characters, not UTF-16 code units: '🔑'.length is 2, so .length
  // would wrongly accept a password one grapheme short of the minimum.
  // Array.from iterates by code point exactly as a spread would, without
  // tripping @typescript-eslint/no-misused-spread's warning against
  // spreading a string.
  const length = Array.from(candidate).length;
  if (length < policy.minLength) {
    violations.push({
      rule: 'min-length',
      message: `Password must be at least ${String(policy.minLength)} characters long.`,
    });
  }

  // Not a tenant setting: the maximum exists to bound work, not to shape
  // passwords, so no tenant configures it. Stated here as well as at every
  // form read (readPasswordField in @odudu/kernel) because the seed CLI is
  // a writer that reads no form, and a password it accepted but the login
  // form refused would be one nobody could sign in with.
  if (length > MAX_PASSWORD_LENGTH) {
    violations.push({ rule: PASSWORD_TOO_LONG.rule, message: PASSWORD_TOO_LONG.message });
  }

  if (policy.requireDigit && !/\d/u.test(candidate)) {
    violations.push({ rule: 'require-digit', message: 'Password must contain a digit.' });
  }
  if (policy.requireUppercase && !/[A-Z]/u.test(candidate)) {
    violations.push({
      rule: 'require-uppercase',
      message: 'Password must contain an uppercase letter.',
    });
  }
  if (policy.requireLowercase && !/[a-z]/u.test(candidate)) {
    violations.push({
      rule: 'require-lowercase',
      message: 'Password must contain a lowercase letter.',
    });
  }
  if (policy.requireSpecial && !SPECIAL_CHARACTER.test(candidate)) {
    violations.push({
      rule: 'require-special',
      message: 'Password must contain a special character.',
    });
  }

  if (
    policy.notUsername &&
    subject.username.length > 0 &&
    candidate.toLowerCase().includes(subject.username.toLowerCase())
  ) {
    violations.push({ rule: 'not-username', message: 'Password must not contain the username.' });
  }

  // Matches the local part, not the whole address: a candidate containing
  // just the account name half of the email is exactly as weak as one
  // containing the username, whether or not the two happen to be equal.
  const emailLocalPart = subject.email?.split('@')[0] ?? '';
  if (
    policy.notEmail &&
    subject.email !== null &&
    emailLocalPart.length > 0 &&
    candidate.toLowerCase().includes(emailLocalPart.toLowerCase())
  ) {
    violations.push({
      rule: 'not-email',
      message: 'Password must not contain the email address.',
    });
  }

  return violations;
}
