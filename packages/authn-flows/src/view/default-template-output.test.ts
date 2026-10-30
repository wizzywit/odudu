import { DEFAULT_PAGE_LOCALE, type PageLocale, type RenderedPage } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { type PasswordViolation } from '#/schema/password-violation';
import { type RequiredAction } from '#/schema/required-action';
import { renderPasskeyEnrolmentPage } from '#/view/passkey-enrolment-html';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';
import { renderRequiredActionPage } from '#/view/required-action-html';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';
import { renderUpdatePasswordPage } from '#/view/update-password-html';

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
const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=acme&algorithm=SHA1&digits=6&period=30',
};
const PASSKEY = {
  options: {
    rp: { name: 'acme', id: 'id.example.com' },
    user: { id: 'c3ViamVjdA', name: 'ada', displayName: 'ada' },
    challenge: 'Q0hBTExFTkdF',
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
    authenticatorSelection: {
      residentKey: 'required' as const,
      userVerification: 'required' as const,
    },
    excludeCredentials: [{ id: 'ZXhpc3Rpbmc', type: 'public-key' as const }],
  },
};
const CODES = ['abcd-efgh-ijkl', 'mnop-qrst-uvwx', 'yz23-4567-89ab'];
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
const VIOLATIONS: PasswordViolation[] = [
  { rule: 'min-length', message: 'too short', minLength: 12 },
  { rule: 'require-digit', message: 'needs a digit' },
  { rule: 'common-password', message: 'common' },
  { rule: 'unheard-of', message: '<b>hostile</b> & "rule"' },
];
const SIGN_IN = '/tenants/acme/protocol/openid-connect/auth?response_type=code&client_id=a&state=1';

describe('the TOTP enrolment page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      expect(
        markup(renderTotpEnrolmentPage('acme', 'sess-1', OFFER, undefined, locale)),
      ).toMatchSnapshot();
    });
  }

  it('renders a refused code byte-identically', () => {
    expect(
      markup(
        renderTotpEnrolmentPage('acme', 'sess-1', OFFER, 'code_mismatch', DEFAULT_PAGE_LOCALE),
      ),
    ).toMatchSnapshot();
  });

  it('renders hostile text byte-identically', () => {
    const hostile = { secret: HOSTILE, uri: `otpauth://totp/${HOSTILE}` };
    expect(
      markup(renderTotpEnrolmentPage(HOSTILE, HOSTILE, hostile, 'code_mismatch', ARABIC_DARK)),
    ).toMatchSnapshot();
  });
});

describe('the passkey enrolment page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      expect(
        markup(renderPasskeyEnrolmentPage('acme', 'sess-1', PASSKEY, undefined, locale)),
      ).toMatchSnapshot();
    });
  }

  it('renders a refused enrolment byte-identically', () => {
    expect(
      markup(
        renderPasskeyEnrolmentPage(
          'acme',
          'sess-1',
          PASSKEY,
          'passkey_not_added',
          DEFAULT_PAGE_LOCALE,
        ),
      ),
    ).toMatchSnapshot();
  });

  it('renders options without excluded credentials byte-identically', () => {
    const options = {
      rp: PASSKEY.options.rp,
      user: PASSKEY.options.user,
      challenge: PASSKEY.options.challenge,
      pubKeyCredParams: PASSKEY.options.pubKeyCredParams,
    };
    expect(
      markup(renderPasskeyEnrolmentPage('acme', 'sess-1', { options }, undefined, DARK)),
    ).toMatchSnapshot();
  });

  it('renders hostile text byte-identically', () => {
    const hostile = {
      options: { ...PASSKEY.options, rp: { name: '</script><script>alert(1)</script>', id: 'x' } },
    };
    expect(
      markup(
        renderPasskeyEnrolmentPage(HOSTILE, HOSTILE, hostile, 'passkey_not_added', ARABIC_DARK),
      ),
    ).toMatchSnapshot();
  });
});

describe('the recovery codes page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      expect(
        markup(
          renderRecoveryCodesPage(
            'acme',
            'sess-1',
            { codes: CODES, replaced: false },
            undefined,
            locale,
          ),
        ),
      ).toMatchSnapshot();
    });
  }

  it('renders a set that replaces an earlier one byte-identically', () => {
    expect(
      markup(
        renderRecoveryCodesPage(
          'acme',
          'sess-1',
          { codes: CODES, replaced: true },
          undefined,
          DEFAULT_PAGE_LOCALE,
        ),
      ),
    ).toMatchSnapshot();
  });

  it('renders a page returned to without saving byte-identically', () => {
    expect(
      markup(
        renderRecoveryCodesPage(
          'acme',
          'sess-1',
          { codes: CODES, replaced: true },
          'codes_not_saved',
          DARK,
        ),
      ),
    ).toMatchSnapshot();
  });

  it('renders hostile text byte-identically', () => {
    expect(
      markup(
        renderRecoveryCodesPage(
          HOSTILE,
          HOSTILE,
          { codes: [HOSTILE], replaced: true },
          'codes_not_saved',
          ARABIC_DARK,
        ),
      ),
    ).toMatchSnapshot();
  });
});

describe('the update-password page under the default template', () => {
  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      expect(
        markup(renderUpdatePasswordPage('acme', 'sess-1', [], RULES, locale)),
      ).toMatchSnapshot();
    });
  }

  it('renders every rule a tenant can enable byte-identically', () => {
    expect(
      markup(renderUpdatePasswordPage('acme', 'sess-1', [], ALL_RULES, DEFAULT_PAGE_LOCALE)),
    ).toMatchSnapshot();
  });

  it('renders a refused candidate with every violation byte-identically', () => {
    expect(
      markup(renderUpdatePasswordPage('acme', 'sess-1', VIOLATIONS, ALL_RULES, DARK)),
    ).toMatchSnapshot();
  });

  it('renders a violation with no minimum byte-identically', () => {
    const own = [{ rule: 'min-length', message: 'too short' }];
    expect(
      markup(renderUpdatePasswordPage('acme', 'sess-1', own, RULES, DEFAULT_PAGE_LOCALE)),
    ).toMatchSnapshot();
  });

  it('renders hostile text byte-identically', () => {
    expect(
      markup(renderUpdatePasswordPage(HOSTILE, HOSTILE, VIOLATIONS, RULES, ARABIC_DARK)),
    ).toMatchSnapshot();
  });
});

describe('the required-action page under the default template', () => {
  const ACTIONS: RequiredAction[] = [
    'update-password',
    'configure-totp',
    'configure-passkey',
    'generate-recovery-codes',
  ];

  for (const [name, locale] of LOCALES) {
    it(`renders byte-identically (${name})`, () => {
      expect(
        markup(renderRequiredActionPage('configure-passkey', SIGN_IN, locale)),
      ).toMatchSnapshot();
    });
  }

  it('renders every action, with and without a way back, byte-identically', () => {
    for (const action of ACTIONS) {
      expect(markup(renderRequiredActionPage(action, null, DEFAULT_PAGE_LOCALE))).toMatchSnapshot(
        `${action} without a way back`,
      );
    }
  });

  it('renders hostile text byte-identically', () => {
    const hostile = HOSTILE as unknown as RequiredAction;
    expect(
      markup(renderRequiredActionPage(hostile, `/p?a=${HOSTILE}`, ARABIC_DARK)),
    ).toMatchSnapshot();
  });
});
