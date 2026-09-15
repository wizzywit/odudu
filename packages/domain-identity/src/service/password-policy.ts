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

  if (
    policy.notEmail &&
    subject.email !== null &&
    subject.email.length > 0 &&
    candidate.toLowerCase().includes(subject.email.toLowerCase())
  ) {
    violations.push({
      rule: 'not-email',
      message: 'Password must not contain the email address.',
    });
  }

  return violations;
}
