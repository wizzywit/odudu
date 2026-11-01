import { DEFAULT_PAGE_LOCALE, type PageLocale, type RenderedPage } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { type LinkedRequiredAction } from '#/usecase/action-token';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationReadyPage,
  renderRegistrationSucceededPage,
  renderRegistrationUsernameGonePage,
  type RegistrationFailure,
} from '#/view/registration-html';
import {
  renderResetLinkFailedPage,
  renderResetPasswordFactorsRemovedPage,
  renderResetPasswordForm,
  renderResetPasswordSucceededPage,
  renderResetRequestFailedPage,
  renderResetRequestForm,
  renderResetRequestedPage,
} from '#/view/reset-html';
import {
  renderRequiredActionsFactorsRemovedPage,
  renderRequiredActionsForm,
  renderRequiredActionsSucceededPage,
} from '#/view/required-actions-html';
import {
  renderEmailConfirmPage,
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
} from '#/view/verification-html';

const DARK: PageLocale = { ...DEFAULT_PAGE_LOCALE, theme: 'dark' };
const ARABIC_DARK: PageLocale = { tag: 'ar', dir: 'rtl', theme: 'dark' };
const LOCALES: [string, PageLocale][] = [
  ['default', DEFAULT_PAGE_LOCALE],
  ['dark', DARK],
  ['arabic dark', ARABIC_DARK],
];

// A random nonce is the only part of a page that differs between two renders.
function markup(page: RenderedPage): string {
  return page.html.replace(/nonce="[^"]+"/gu, 'nonce="NONCE"');
}

const HOSTILE = '<script>alert("x")</script>\'o\' & co';
const SIGN_IN = '/tenants/acme/protocol/openid-connect/auth?response_type=code&client_id=a&state=1';
const RULES = {
  minLength: 12,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};
const ALL_RULES = {
  minLength: 15,
  requireDigit: true,
  requireUppercase: true,
  requireLowercase: true,
  requireSpecial: true,
};
const VIOLATIONS = [
  { rule: 'min-length', message: 'too short', minLength: 12 },
  { rule: 'require-digit', message: 'needs a digit' },
  { rule: 'unheard-of', message: '<b>hostile</b> & "rule"' },
];
const ACTIONS: LinkedRequiredAction[] = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
];
const UNKNOWN_ACTION = '<i>rotate</i>' as unknown as LinkedRequiredAction;

describe('the registration pages under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the form byte-identically (${name})`, () => {
      expect(markup(renderRegistrationForm('acme', { rules: RULES }, locale))).toMatchSnapshot();
    });
  }

  it('renders the form with every option and hostile text', () => {
    const page = renderRegistrationForm(
      HOSTILE,
      {
        rules: ALL_RULES,
        signInPath: SIGN_IN,
        username: HOSTILE,
        email: '"><x@y.z',
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(markup(page)).toMatchSnapshot();
    expect(page.script).not.toBeNull();
  });

  const failures: [string, RegistrationFailure][] = [
    ['every field missing', { missing: ['passwordConfirm', 'password', 'email', 'username'] }],
    ['one field missing', { missing: ['email'] }],
    ['email taken', { refusal: 'email_taken' }],
    ['username taken', { refusal: 'username_taken' }],
    ['invalid email', { refusal: 'invalid_email' }],
    ['invalid username', { refusal: 'invalid_username' }],
    ['a mismatch', { mismatch: true }],
    ['password violations', { violations: VIOLATIONS }],
  ];
  for (const [name, failure] of failures) {
    it(`renders the form refused for ${name}`, () => {
      const page = renderRegistrationForm(
        'acme',
        { rules: ALL_RULES, failure, username: 'ann', email: 'ann@example.com' },
        DEFAULT_PAGE_LOCALE,
      );
      expect(markup(page)).toMatchSnapshot();
    });
  }

  it('renders the outcome pages', () => {
    const pages = [
      renderRegistrationFailedPage('acme', null, DEFAULT_PAGE_LOCALE),
      renderRegistrationFailedPage(HOSTILE, SIGN_IN, DEFAULT_PAGE_LOCALE),
      renderRegistrationSucceededPage(true, SIGN_IN, DEFAULT_PAGE_LOCALE),
      renderRegistrationSucceededPage(false, null, DARK),
      renderRegistrationUsernameGonePage(HOSTILE, DEFAULT_PAGE_LOCALE),
      renderRegistrationReadyPage(null, DEFAULT_PAGE_LOCALE),
      renderRegistrationReadyPage(SIGN_IN, ARABIC_DARK),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
  });
});

describe('the reset pages under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the request form byte-identically (${name})`, () => {
      expect(markup(renderResetRequestForm('acme', {}, locale))).toMatchSnapshot();
    });
  }

  it('renders the request form with every option and hostile text', () => {
    const page = renderResetRequestForm(
      HOSTILE,
      { signInPath: SIGN_IN, emailRequired: true, email: '"><x@y.z' },
      DEFAULT_PAGE_LOCALE,
    );
    expect(markup(page)).toMatchSnapshot();
  });

  it('renders the request form refused with nothing typed', () => {
    const page = renderResetRequestForm('acme', { emailRequired: true }, DEFAULT_PAGE_LOCALE);
    expect(markup(page)).toMatchSnapshot();
  });

  for (const [name, locale] of LOCALES) {
    it(`renders the password form byte-identically (${name})`, () => {
      const page = renderResetPasswordForm('acme', 'key-1', undefined, RULES, locale);
      expect(markup(page)).toMatchSnapshot();
    });
  }

  it('renders the password form with hostile text and each failure', () => {
    const pages = [
      renderResetPasswordForm(HOSTILE, HOSTILE, undefined, ALL_RULES, DEFAULT_PAGE_LOCALE),
      renderResetPasswordForm('acme', 'key-1', 'required', ALL_RULES, DEFAULT_PAGE_LOCALE),
      renderResetPasswordForm('acme', 'key-1', VIOLATIONS, ALL_RULES, DEFAULT_PAGE_LOCALE),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
    for (const page of pages) expect(page.script).not.toBeNull();
  });

  it('renders the outcome pages', () => {
    const pages = [
      renderResetRequestedPage(null, DEFAULT_PAGE_LOCALE),
      renderResetRequestedPage(SIGN_IN, DARK),
      renderResetRequestFailedPage('acme', null, DEFAULT_PAGE_LOCALE),
      renderResetRequestFailedPage(HOSTILE, SIGN_IN, DEFAULT_PAGE_LOCALE),
      renderResetPasswordSucceededPage(null, DEFAULT_PAGE_LOCALE),
      renderResetPasswordSucceededPage(SIGN_IN, ARABIC_DARK),
      renderResetPasswordFactorsRemovedPage(null, DEFAULT_PAGE_LOCALE),
      renderResetPasswordFactorsRemovedPage(SIGN_IN, DEFAULT_PAGE_LOCALE),
      renderResetLinkFailedPage(null, null, DEFAULT_PAGE_LOCALE),
      renderResetLinkFailedPage('/tenants/acme/login-actions/reset-password', SIGN_IN, DARK),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
  });
});

describe('the verification pages under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the succeeded page byte-identically (${name})`, () => {
      expect(markup(renderVerificationSucceededPage(null, locale))).toMatchSnapshot();
    });
  }

  it('renders the succeeded and failed pages with and without a way back', () => {
    const pages = [
      renderVerificationSucceededPage(SIGN_IN, DEFAULT_PAGE_LOCALE),
      renderVerificationFailedPage(null, DEFAULT_PAGE_LOCALE),
      renderVerificationFailedPage(SIGN_IN, ARABIC_DARK),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
  });

  for (const [name, locale] of LOCALES) {
    it(`renders the confirmation page byte-identically (${name})`, () => {
      expect(markup(renderEmailConfirmPage('acme', 'key-1', null, locale))).toMatchSnapshot();
    });
  }

  it('renders the confirmation page naming an account, with hostile text', () => {
    const pages = [
      renderEmailConfirmPage('acme', 'key-1', 'ann', DEFAULT_PAGE_LOCALE),
      renderEmailConfirmPage(HOSTILE, HOSTILE, HOSTILE, DEFAULT_PAGE_LOCALE),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
  });
});

describe('the required-actions pages under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the form byte-identically (${name})`, () => {
      const page = renderRequiredActionsForm(
        'acme',
        'key-1',
        ['configure-totp'],
        false,
        undefined,
        RULES,
        locale,
      );
      expect(markup(page)).toMatchSnapshot();
    });
  }

  it('renders the form asking for a password, refused and not', () => {
    const pages = [
      renderRequiredActionsForm(
        'acme',
        'key-1',
        ACTIONS,
        true,
        undefined,
        ALL_RULES,
        DEFAULT_PAGE_LOCALE,
      ),
      renderRequiredActionsForm(
        'acme',
        'key-1',
        ['update-password'],
        true,
        'required',
        RULES,
        DEFAULT_PAGE_LOCALE,
      ),
      renderRequiredActionsForm(
        'acme',
        'key-1',
        ['update-password'],
        true,
        VIOLATIONS,
        ALL_RULES,
        DARK,
      ),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
    for (const page of pages) expect(page.script).not.toBeNull();
  });

  it('renders the form with hostile text and an action it has no wording for', () => {
    const page = renderRequiredActionsForm(
      HOSTILE,
      HOSTILE,
      [UNKNOWN_ACTION, 'configure-passkey'],
      false,
      undefined,
      RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(markup(page)).toMatchSnapshot();
    expect(page.script).toBeNull();
  });

  it('renders the outcome pages', () => {
    const pages = [
      renderRequiredActionsSucceededPage([], null, DEFAULT_PAGE_LOCALE),
      renderRequiredActionsSucceededPage([], SIGN_IN, DARK),
      renderRequiredActionsSucceededPage(ACTIONS, null, DEFAULT_PAGE_LOCALE),
      renderRequiredActionsSucceededPage([UNKNOWN_ACTION], SIGN_IN, ARABIC_DARK),
      renderRequiredActionsFactorsRemovedPage([], null, DEFAULT_PAGE_LOCALE),
      renderRequiredActionsFactorsRemovedPage(['configure-totp'], SIGN_IN, DEFAULT_PAGE_LOCALE),
    ];
    expect(pages.map(markup)).toMatchSnapshot();
  });
});
