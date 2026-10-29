import {
  PASSWORD_CONFIRM_FIELD_ID,
  passwordConfirmToggle,
  type PageLocale,
  type PasswordRules,
  type RenderedPage,
} from '@odudu/kernel';
import { escapeHtml, intro, page } from '#/view/document';
import { links, type WayOn } from '#/view/links';
import {
  echoedValue,
  firstInvalidField,
  invalidAttributes,
  problemSummary,
  type Problem,
} from '#/view/form-error';
import { returnToField } from '#/view/return-to';
import { t, tHtml, type MessageId } from '#/view/messages';
import { passwordField } from '#/view/password-field';
import { fillNotice, fillPage } from '#/view/template';
import { ruleHtml, type PasswordViolation } from '#/view/password-rules';

export type RegistrationField = 'username' | 'email' | 'password' | 'passwordConfirm';

export type RegistrationRefusal =
  'email_taken' | 'username_taken' | 'invalid_email' | 'invalid_username';

// Why the submission was refused, in terms of the form: the fields left
// empty, one reason the person can act on, or every rule the password broke,
// listed at once so a policy with four rules does not take four submissions
// to satisfy.
export type RegistrationFailure =
  | { readonly missing: readonly RegistrationField[] }
  | { readonly refusal: RegistrationRefusal }
  | { readonly mismatch: true }
  | { readonly violations: readonly PasswordViolation[] };

const REFUSAL_FIELD: Readonly<Record<RegistrationRefusal, RegistrationField>> = {
  email_taken: 'email',
  username_taken: 'username',
  invalid_email: 'email',
  invalid_username: 'username',
};

const REFUSAL_MESSAGE: Readonly<Record<RegistrationRefusal, MessageId>> = {
  email_taken: 'registration.refusal.emailTaken',
  username_taken: 'registration.refusal.usernameTaken',
  invalid_email: 'registration.refusal.invalidEmail',
  invalid_username: 'registration.refusal.invalidUsername',
};

const REQUIRED_MESSAGE: Readonly<Record<RegistrationField, MessageId>> = {
  username: 'registration.refusal.usernameRequired',
  email: 'registration.refusal.emailRequired',
  password: 'registration.refusal.passwordRequired',
  passwordConfirm: 'registration.refusal.confirmRequired',
};

const FIELD_ORDER: readonly RegistrationField[] = [
  'username',
  'email',
  'password',
  'passwordConfirm',
];

function problemsOf(failure: RegistrationFailure | undefined, locale: PageLocale): Problem[] {
  if (failure === undefined) return [];
  if ('missing' in failure) {
    return FIELD_ORDER.filter((field) => failure.missing.includes(field)).map((field) => ({
      fields: [field],
      html: tHtml(locale, REQUIRED_MESSAGE[field]),
    }));
  }
  if ('mismatch' in failure) {
    return [
      {
        fields: ['passwordConfirm'],
        html: tHtml(locale, 'registration.refusal.passwordMismatch'),
      },
    ];
  }
  if ('refusal' in failure) {
    return [
      {
        fields: [REFUSAL_FIELD[failure.refusal]],
        html: tHtml(locale, REFUSAL_MESSAGE[failure.refusal]),
      },
    ];
  }
  return failure.violations.map((violation) => ({
    fields: ['password'],
    html: ruleHtml(violation, locale),
  }));
}

// What the form is rendered with beyond its tenant. Only the username and the
// email are ever given back: the password is never put in a field again.
export interface RegistrationForm {
  // What the tenant holds a password to, told to the person beside the field.
  readonly rules: PasswordRules;
  readonly signInPath?: string | null;
  readonly failure?: RegistrationFailure;
  readonly username?: string;
  readonly email?: string;
}

function backToSignIn(signInPath: string | null | undefined, locale: PageLocale): WayOn | null {
  return signInPath === null || signInPath === undefined
    ? null
    : { href: signInPath, text: tHtml(locale, 'link.backToSignIn') };
}

export function renderRegistrationForm(
  tenant: string,
  form: RegistrationForm,
  locale: PageLocale,
): RenderedPage {
  const action = `/tenants/${escapeHtml(encodeURIComponent(tenant))}/login-actions/registration`;
  const problems = problemsOf(form.failure, locale);
  const focus = firstInvalidField(problems, FIELD_ORDER);
  const attributes = (field: RegistrationField): string =>
    `${invalidAttributes(problems, field)}${focus === field ? ' autofocus' : ''}`;
  const password = passwordField(
    'registration.password',
    form.rules,
    problems,
    focus === 'password',
    locale,
  );
  const value = (text: string | undefined): string => {
    const echoed = text === undefined ? undefined : echoedValue(text);
    return echoed === undefined ? '' : ` value="${escapeHtml(echoed)}"`;
  };
  return page(
    t(locale, 'registration.title'),
    fillPage(
      'registration',
      {
        intro: intro(tHtml(locale, 'registration.title'), tenant),
        error: problemSummary(problems),
        'form.open': `<form method="post" action="${action}">${returnToField(form.signInPath)}`,
        fields: `<label>${tHtml(locale, 'registration.username')} <input type="text" name="username" autocomplete="username"${value(form.username)}${attributes('username')}></label>
  <label>${tHtml(locale, 'registration.email')} <input type="email" name="email" autocomplete="email"${value(form.email)}${attributes('email')}></label>
  ${password.html}
  <label>${tHtml(locale, 'registration.passwordConfirm')} <input type="password" name="password_confirm" id="${PASSWORD_CONFIRM_FIELD_ID}" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"${attributes('passwordConfirm')}></label>\n  ${passwordConfirmToggle(password.script)}`,
        submit: `<button type="submit">${tHtml(locale, 'registration.submit')}</button>`,
        'form.close': '</form>',
        links: links([backToSignIn(form.signInPath, locale)]),
      },
      locale,
    ),
    password.script,
    [],
    locale,
    'registration',
  );
}

// The one refusal that is not about a field: registration cannot run at all.
// It stays a page, with the way to try again and the way back.
export function renderRegistrationFailedPage(
  tenant: string,
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  const retry = `/tenants/${encodeURIComponent(tenant)}/login-actions/registration`;
  return page(
    t(locale, 'registration.failed.title'),
    fillNotice(
      `<h1>${tHtml(locale, 'registration.failed.title')}</h1>
<p>${tHtml(locale, 'registration.refusal.unavailable')}</p>${links([
        {
          href: signInPath === null ? retry : retryWith(retry, signInPath),
          text: tHtml(locale, 'link.tryAgain'),
        },
        backToSignIn(signInPath, locale),
      ])}`,
      '',
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

function retryWith(path: string, signInPath: string): string {
  return `${path}?${new URLSearchParams({ return_to: signInPath }).toString()}`;
}

// The word "verify" only appears here when the tenant actually requires it —
// the whole point is that an unverified account cannot sign in yet, so the
// page must not claim otherwise.
export function renderRegistrationSucceededPage(
  verifyEmailRequired: boolean,
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  const prefix = verifyEmailRequired ? 'registration.check' : 'registration.succeeded';
  const next = tHtml(
    locale,
    verifyEmailRequired ? 'registration.check.next' : 'registration.succeeded.signIn',
  );
  return page(
    t(locale, `${prefix}.title`),
    fillNotice(
      `<h1>${tHtml(locale, `${prefix}.title`)}</h1>
<p>${next}</p>`,
      links([backToSignIn(signInPath, locale)]),
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

// The link was good, but the username it asked for went to somebody else in
// the meantime. Nothing was created; the way on is the form again.
export function renderRegistrationUsernameGonePage(
  tenant: string,
  locale: PageLocale,
): RenderedPage {
  const form = `/tenants/${encodeURIComponent(tenant)}/login-actions/registration`;
  return page(
    t(locale, 'registration.usernameGone.title'),
    fillNotice(
      `<h1>${tHtml(locale, 'registration.usernameGone.title')}</h1>
<p>${tHtml(locale, 'registration.usernameGone.next')}</p>${links([
        { href: form, text: tHtml(locale, 'link.registerAgain') },
      ])}`,
      '',
      locale,
    ),
    null,
    [],
    locale,
    'notice',
  );
}

// Said once the account exists: with the way back when the browser that opened
// the link holds the sign-in it came from, in words when it does not.
export function renderRegistrationReadyPage(
  signInPath: string | null,
  locale: PageLocale,
): RenderedPage {
  const next =
    signInPath === null
      ? `\n<p>${tHtml(locale, 'registration.ready.next')}</p>`
      : links([{ href: signInPath, text: tHtml(locale, 'link.continueToSignIn') }]);
  return page(
    t(locale, 'registration.ready.title'),
    fillNotice(`<h1>${tHtml(locale, 'registration.ready.title')}</h1>${next}`, '', locale),
    null,
    [],
    locale,
    'notice',
  );
}
