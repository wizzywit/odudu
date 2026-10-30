import { DEFAULT_PAGE_LOCALE, type PageLocale, type RenderedPage } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import {
  renderLoggedOutPage,
  renderLoggedOutRedirectPage,
  renderLogoutConfirmationPage,
  renderLogoutRedirectRefusedPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';
import { renderSelectAccountPage } from '#/view/select-account-html';

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

const NO_WAYS = {};
const BOTH_WAYS = { resetPassword: '/reset?x=1&y=2', createAccount: '/register' };
const HOSTILE = '<b>"o\'brien"</b> & co';

describe('the sign-in page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the password step byte-identically (${name})`, () => {
      const page = renderLoginForm(
        't1',
        'sess-1',
        'password',
        false,
        false,
        undefined,
        false,
        undefined,
        NO_WAYS,
        locale,
      );
      expect(markup(page)).toMatchSnapshot();
    });
  }

  it('renders every option of the password step byte-identically', () => {
    const page = renderLoginForm(
      HOSTILE,
      'sess-<1>',
      'password',
      true,
      true,
      { messageId: 'login.refusal.signInFailed', username: HOSTILE },
      true,
      HOSTILE,
      BOTH_WAYS,
      DEFAULT_PAGE_LOCALE,
    );
    expect(markup(page)).toMatchSnapshot();
    expect(page.script).not.toBeNull();
  });

  it('renders a refusal that gives back no username byte-identically', () => {
    const page = renderLoginForm(
      't1',
      'sess-1',
      'password',
      false,
      false,
      { messageId: 'login.refusal.signInFailed' },
      false,
      undefined,
      BOTH_WAYS,
      ARABIC_DARK,
    );
    expect(markup(page)).toMatchSnapshot();
  });

  for (const form of ['otp', 'recovery-code', 'mystery']) {
    it(`renders the ${form} step byte-identically`, () => {
      const page = renderLoginForm(
        't1',
        'sess-1',
        form,
        true,
        true,
        { messageId: 'login.refusal.codeFailed' },
        false,
        'App',
        BOTH_WAYS,
        DEFAULT_PAGE_LOCALE,
      );
      expect(markup(page)).toMatchSnapshot();
    });
  }
});

describe('the authorize error and unverified-email pages under the default template', () => {
  it('renders the error without a way on byte-identically', () => {
    const page = renderAuthorizeErrorPage('invalid_request', HOSTILE, undefined, DARK);
    expect(markup(page)).toMatchSnapshot();
  });

  it('renders the error with a way on byte-identically', () => {
    const wayOn = { kind: 'restart', href: '/authorize?a=1&b=2' } as const;
    expect(
      markup(renderAuthorizeErrorPage('access_denied', 'No.', wayOn, DEFAULT_PAGE_LOCALE)),
    ).toMatchSnapshot();
    const back = { kind: 'return', href: 'https://rp.test/cb' } as const;
    expect(markup(renderAuthorizeErrorPage('x', 'y', back, ARABIC_DARK))).toMatchSnapshot();
  });

  for (const hasEmail of [true, false]) {
    for (const signInPath of [null, '/authorize?a=1&b=2']) {
      it(`renders unverified email (mail ${String(hasEmail)}, path ${String(signInPath)})`, () => {
        const page = renderEmailUnverifiedPage(hasEmail, signInPath, DEFAULT_PAGE_LOCALE);
        expect(markup(page)).toMatchSnapshot();
      });
    }
  }
});

const CONSENT = {
  tenant: 't1',
  authSessionId: 'sess-1',
  clientName: 'App',
  clientPages: { clientUri: null, policyUri: null, tosUri: null },
  defaultScopes: ['openid'],
  optionalScopes: [],
  alreadyGranted: [],
  scopeLabels: {},
};

describe('the consent page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders the plainest page byte-identically (${name})`, () => {
      expect(markup(renderConsentPage(CONSENT, locale))).toMatchSnapshot();
    });
  }

  it('renders every option byte-identically', () => {
    const page = renderConsentPage(
      {
        ...CONSENT,
        tenant: HOSTILE,
        authSessionId: 'sess-<1>',
        clientName: HOSTILE,
        clientPages: {
          clientUri: 'https://rp.test/?a=1&b=2',
          policyUri: 'https://rp.test/privacy',
          tosUri: 'https://rp.test/terms',
        },
        defaultScopes: ['openid', 'profile', '<x>'],
        optionalScopes: ['email', 'offline_access', 'a"b'],
        alreadyGranted: ['email'],
        scopeLabels: { profile: 'Your name', email: HOSTILE, offline_access: 'Stay signed in' },
      },
      DEFAULT_PAGE_LOCALE,
    );
    expect(markup(page)).toMatchSnapshot();
  });

  it('renders only the pages the client registered byte-identically', () => {
    const clientPages = { clientUri: null, policyUri: 'https://rp.test/privacy', tosUri: null };
    expect(markup(renderConsentPage({ ...CONSENT, clientPages }, ARABIC_DARK))).toMatchSnapshot();
  });
});

describe('the account chooser under the default template', () => {
  const accounts = [
    { sessionId: 's1', displayName: 'alice@example.test' },
    { sessionId: 's"2', displayName: HOSTILE },
  ];
  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      const input = { tenant: 't1', authSessionId: 'sess-1', accounts };
      expect(markup(renderSelectAccountPage(input, locale))).toMatchSnapshot();
    });
  }

  it('renders no accounts byte-identically', () => {
    const input = { tenant: HOSTILE, authSessionId: 'sess-<1>', accounts: [] };
    expect(markup(renderSelectAccountPage(input, DEFAULT_PAGE_LOCALE))).toMatchSnapshot();
  });
});

describe('the logout pages under the default template', () => {
  const NONE = { clientId: null, postLogoutRedirectUri: null, state: null };
  const ALL = { clientId: 'c"1', postLogoutRedirectUri: 'https://rp.test/?a=1&b=2', state: '<s>' };
  const FRAMES = ['https://rp-a.test/fc?x=1&y=2', 'https://rp-b.test/logout'];

  for (const [name, locale] of LOCALES) {
    it(`renders the confirmation byte-identically (${name})`, () => {
      expect(
        markup(renderLogoutConfirmationPage('t1', 'sid', 'csrf', NONE, locale)),
      ).toMatchSnapshot();
    });
  }

  it('renders the confirmation with every hidden field byte-identically', () => {
    expect(
      markup(renderLogoutConfirmationPage(HOSTILE, 'sid<1>', 'csrf"', ALL, DEFAULT_PAGE_LOCALE)),
    ).toMatchSnapshot();
  });

  it('renders the confirmation with one hidden field byte-identically', () => {
    const only = { ...NONE, state: 'abc' };
    expect(
      markup(renderLogoutConfirmationPage('t1', 'sid', 'csrf', only, DEFAULT_PAGE_LOCALE)),
    ).toMatchSnapshot();
  });

  for (const [name, locale] of LOCALES) {
    it(`renders the pages with nothing to confirm byte-identically (${name})`, () => {
      expect(markup(renderNoActiveSessionPage(locale))).toMatchSnapshot();
      expect(markup(renderLogoutUnauthenticatedPage(locale))).toMatchSnapshot();
      expect(markup(renderLoggedOutPage([], locale))).toMatchSnapshot();
      expect(markup(renderLogoutRedirectRefusedPage([], locale))).toMatchSnapshot();
    });
  }

  it('renders the pages that frame relying parties byte-identically', () => {
    expect(markup(renderLoggedOutPage(FRAMES, DARK))).toMatchSnapshot();
    expect(markup(renderLogoutRedirectRefusedPage(FRAMES, DEFAULT_PAGE_LOCALE))).toMatchSnapshot();
  });

  it('renders the redirecting page byte-identically', () => {
    const to = 'https://rp.test/after?a=1&b=2';
    const framed = renderLoggedOutRedirectPage(FRAMES, to, DEFAULT_PAGE_LOCALE);
    expect(markup(framed)).toMatchSnapshot();
    expect(framed.script).not.toBeNull();
    expect(markup(renderLoggedOutRedirectPage([], to, ARABIC_DARK))).toMatchSnapshot();
  });
});
