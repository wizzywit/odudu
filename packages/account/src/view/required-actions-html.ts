import { type PageLocale, type PasswordRules, type RenderedPage } from '@odudu/kernel';
import { type LinkedRequiredAction } from '#/usecase/action-token';
import { escapeHtml, intro, page } from '#/view/document';
import { problemSummary } from '#/view/form-error';
import { links } from '#/view/links';
import { bdi, t, tHtml, type MessageId } from '#/view/messages';
import { passwordField } from '#/view/password-field';
import { fillNotice, fillPage } from '#/view/template';
import { passwordProblems, type PasswordFailure } from '#/view/password-rules';

const ACTION_MESSAGE: Readonly<Record<LinkedRequiredAction, MessageId>> = {
  'update-password': 'requiredActions.action.updatePassword',
  'configure-totp': 'requiredActions.action.configureTotp',
  'configure-passkey': 'requiredActions.action.configurePasskey',
  'generate-recovery-codes': 'requiredActions.action.generateRecoveryCodes',
};

// An action this build has no wording for shows its code, isolated, rather
// than nothing.
function listHtml(actions: readonly LinkedRequiredAction[], locale: PageLocale): string {
  const items = actions.map(
    (action) =>
      `<li>${Object.hasOwn(ACTION_MESSAGE, action) ? tHtml(locale, ACTION_MESSAGE[action]) : bdi(action)}</li>`,
  );
  return `<ul>\n${items.join('\n')}\n</ul>`;
}

// An actions link's own page, shown before anything is consumed: a link
// scanner's GET must not spend it. A password field only where the link
// asks for one, and the page the form comes back to when the password was
// refused, with the reasons in place.
export function renderRequiredActionsForm(
  tenant: string,
  key: string,
  actions: readonly LinkedRequiredAction[],
  setsPassword: boolean,
  failure: PasswordFailure | undefined,
  rules: PasswordRules,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/action-token`;
  const problems = passwordProblems(failure, locale);
  const field = setsPassword
    ? passwordField('requiredActions.newPassword', rules, problems, problems.length > 0, locale)
    : null;
  return page(
    t(locale, 'requiredActions.title'),
    fillPage(
      'required-actions',
      {
        intro: intro(tHtml(locale, 'requiredActions.title'), tenant),
        actions: `<p>${tHtml(locale, 'requiredActions.intro')}</p>
${listHtml(actions, locale)}`,
        error: problemSummary(problems),
        'form.open': `<form method="post" action="${action}">
  <input type="hidden" name="key" value="${escapeHtml(key)}">`,
        fields: field === null ? '' : `\n  ${field.html}`,
        submit: `<button type="submit">${tHtml(locale, 'requiredActions.continue')}</button>`,
        'form.close': '</form>',
      },
      locale,
    ),
    field === null ? null : field.script,
    [],
    locale,
    'required-actions',
  );
}

export function renderRequiredActionsSucceededPage(
  remaining: readonly LinkedRequiredAction[],
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  return requiredActionsSucceeded(remaining, signInPath, locale, false);
}

// The same page for a link that also removed the account's factors.
export function renderRequiredActionsFactorsRemovedPage(
  remaining: readonly LinkedRequiredAction[],
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  return requiredActionsSucceeded(remaining, signInPath, locale, true);
}

function requiredActionsSucceeded(
  remaining: readonly LinkedRequiredAction[],
  signInPath: string | null,
  locale: PageLocale,
  factorsRemoved: boolean,
): RenderedPage {
  const removed = factorsRemoved
    ? `\n<p>${tHtml(locale, 'reset.succeeded.factorsRemoved')}</p>`
    : '';
  const rest =
    remaining.length === 0
      ? signInPath === null
        ? `\n<p>${tHtml(locale, 'requiredActions.succeeded.close')}</p>`
        : ''
      : `\n<p>${tHtml(locale, 'requiredActions.succeeded.finish')}</p>
${listHtml(remaining, locale)}`;
  return page(
    t(locale, 'requiredActions.succeeded.title'),
    fillNotice(
      `<h1>${tHtml(locale, 'requiredActions.succeeded.heading')}</h1>${removed}${rest}${
        signInPath === null
          ? ''
          : links([{ href: signInPath, text: tHtml(locale, 'link.continueToSignIn') }])
      }`,
      '',
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}
