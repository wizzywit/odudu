import { MAX_PASSWORD_LENGTH, type PageLocale } from '@odudu/kernel';
import { type Problem } from '#/view/form-error';
import { bdi, tHtml, type MessageId } from '#/view/messages';

// A rule a candidate password broke: `rule` is the code a catalogue entry is
// looked up by, `message` the developer-facing sentence for a rule this build
// has no entry for, `minLength` the number the minimum-length sentence states.
export interface PasswordViolation {
  rule: string;
  message: string;
  minLength?: number;
}

const RULE_MESSAGE: Readonly<Record<string, MessageId>> = {
  'min-length': 'password.rule.minLength',
  'max-length': 'password.rule.maxLength',
  'require-digit': 'password.rule.requireDigit',
  'require-uppercase': 'password.rule.requireUppercase',
  'require-lowercase': 'password.rule.requireLowercase',
  'require-special': 'password.rule.requireSpecial',
  'not-username': 'password.rule.notUsername',
  'not-email': 'password.rule.notEmail',
  'common-password': 'password.rule.common',
  'not-reused': 'password.rule.notReused',
  'breached-password': 'password.rule.breached',
  'breach-check-unavailable': 'password.rule.breachCheckUnavailable',
};

// The domain's sentences are developer-facing English, so a rule this build
// has no entry for shows that sentence, isolated, rather than nothing.
export function ruleHtml(violation: PasswordViolation, locale: PageLocale): string {
  const id = Object.hasOwn(RULE_MESSAGE, violation.rule) ? RULE_MESSAGE[violation.rule] : undefined;
  // A minimum the page was not told is not one to state.
  if (id === undefined || (violation.rule === 'min-length' && violation.minLength === undefined)) {
    return bdi(violation.message);
  }
  return tHtml(locale, id, { min: violation.minLength ?? 0, max: MAX_PASSWORD_LENGTH });
}

// Why a new password was refused when the form comes back: none was given, or
// every rule the one given broke.
export type PasswordFailure = 'required' | readonly PasswordViolation[];

export function passwordProblems(
  failure: PasswordFailure | undefined,
  locale: PageLocale,
): Problem[] {
  if (failure === undefined) return [];
  if (failure === 'required') {
    return [{ fields: ['password'], html: tHtml(locale, 'reset.required.reason') }];
  }
  return failure.map((violation) => ({ fields: ['password'], html: ruleHtml(violation, locale) }));
}
