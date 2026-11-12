import {
  addressPath,
  MAX_PASSWORD_LENGTH,
  type PageLocale,
  type PasswordRules,
  type RenderedPage,
  type TenantAddress,
} from '@odudu/kernel';
import { type PasswordViolation } from '#/schema/password-violation';
import { cancelButton, type ActionPageVariant } from '#/view/action-cancel';
import { escapeHtml, intro, page } from '#/view/document';
import { invalidAttributes, problemSummary } from '#/view/form-error';
import { passwordField } from '#/view/password-field';
import { bdi, t, tHtml, type MessageId } from '#/view/messages';
import { fillPage } from '#/view/template';

// Every rule a violation can name, by the code the domain reports it under.
const RULE_MESSAGE: Readonly<Record<string, MessageId>> = {
  'min-length': 'updatePassword.rule.minLength',
  'max-length': 'updatePassword.rule.maxLength',
  'require-digit': 'updatePassword.rule.requireDigit',
  'require-uppercase': 'updatePassword.rule.requireUppercase',
  'require-lowercase': 'updatePassword.rule.requireLowercase',
  'require-special': 'updatePassword.rule.requireSpecial',
  'not-username': 'updatePassword.rule.notUsername',
  'not-email': 'updatePassword.rule.notEmail',
  'common-password': 'updatePassword.rule.common',
  'not-reused': 'updatePassword.rule.notReused',
  'current-password': 'updatePassword.rule.currentPassword',
  superseded: 'updatePassword.rule.superseded',
};

// The domain's sentences are developer-facing English, so a rule this build
// has no entry for shows that sentence, isolated, rather than nothing.
function ruleHtml(violation: PasswordViolation, locale: PageLocale): string {
  const id = Object.hasOwn(RULE_MESSAGE, violation.rule) ? RULE_MESSAGE[violation.rule] : undefined;
  // A minimum the page was not told is not one to state.
  if (id === undefined || (violation.rule === 'min-length' && violation.minLength === undefined)) {
    return bdi(violation.message);
  }
  return tHtml(locale, id, { min: violation.minLength ?? 0, max: MAX_PASSWORD_LENGTH });
}

// The page a login parks on while `update-password` is owed, and the page a
// refused candidate comes back to. `violations` is every rule the tenant's
// policy reported, listed at once for the reason evaluatePassword collects
// them all rather than stopping at the first. The hidden auth_session_id is
// this page's own CSRF defence and what resumes the parked login, exactly
// as on the enrolment pages beside it.
function updatePasswordPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  violations: readonly PasswordViolation[] = [],
  rules: PasswordRules,
  locale: PageLocale,
  variant: ActionPageVariant | undefined,
): RenderedPage {
  const target = escapeHtml(
    addressPath(address, '/login-actions/required-action?action=update-password'),
  );
  const problems = violations.map((violation) => ({
    fields: [violation.rule === 'current-password' ? 'current_password' : 'password'],
    html: ruleHtml(violation, locale),
  }));
  const currentRefused = problems.some((problem) => problem.fields.includes('current_password'));
  const password = passwordField(
    'updatePassword.newPassword',
    rules,
    problems,
    problems.length > 0 && !currentRefused,
    locale,
  );
  // Asked of a person an application sent here, whatever age their sign-in:
  // the password in force is what separates them from somebody at their
  // unlocked browser.
  const current =
    variant === 'requested'
      ? `<label>${tHtml(locale, 'updatePassword.currentPassword')} <input type="password" name="current_password" autocomplete="current-password"${invalidAttributes(problems, 'current_password')}${currentRefused ? ' autofocus' : ''}></label>\n`
      : '';
  const title = t(locale, 'updatePassword.title');
  const parts = {
    intro: intro(tHtml(locale, 'updatePassword.title'), tenant),
    error: problemSummary(problems),
    'form.open': `<form method="post" action="${target}">
  <input type="hidden" name="auth_session_id" value="${escapeHtml(authSessionId)}">`,
    fields: `${current}${password.html}`,
    submit: `<button type="submit">${tHtml(locale, 'updatePassword.submit')}</button>${cancelButton(variant, locale)}`,
    'form.close': '</form>',
  };
  // The template's sentence says the account needs a new password before
  // the sign-in can go on, which is not what an application asking is.
  const body = fillPage(
    'update-password',
    parts,
    locale,
    variant === 'requested'
      ? { from: 'updatePassword.intro', to: 'updatePassword.requestedIntro' }
      : undefined,
  );
  return page(title, body, password.script, [], locale, 'update-password');
}

export function renderUpdatePasswordPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  violations: readonly PasswordViolation[] = [],
  rules: PasswordRules,
  locale: PageLocale,
): RenderedPage {
  return updatePasswordPage(tenant, address, authSessionId, violations, rules, locale, undefined);
}

// The same page for a person an application sent here, who may leave it again.
export function renderRequestedUpdatePasswordPage(
  tenant: string,
  address: TenantAddress,
  authSessionId: string,
  violations: readonly PasswordViolation[] = [],
  rules: PasswordRules,
  locale: PageLocale,
): RenderedPage {
  return updatePasswordPage(tenant, address, authSessionId, violations, rules, locale, 'requested');
}
