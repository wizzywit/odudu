import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { ar, en } from '#/view/messages';
import {
  renderPasskeyEnrolmentPage,
  renderRequestedPasskeyEnrolmentPage,
} from '#/view/passkey-enrolment-html';
import {
  renderRecoveryCodesPage,
  renderRequestedRecoveryCodesPage,
} from '#/view/recovery-codes-html';
import {
  renderRequestedTotpEnrolmentPage,
  renderTotpEnrolmentPage,
} from '#/view/totp-enrolment-html';
import {
  renderRequestedUpdatePasswordPage,
  renderUpdatePasswordPage,
} from '#/view/update-password-html';
import { ARABIC } from '@odudu/testkit/i18n';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const RULES = {
  minLength: 8,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};
const TOTP = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=X',
};
const CODES = { codes: ['ABCDE-FGHJK'], replaced: false };
const PASSKEY = {
  options: {
    rp: { name: 'acme', id: 'id.example.com' },
    user: { id: 'c3ViamVjdA', name: 'ada', displayName: 'ada' },
    challenge: 'Q0hBTExFTkdF',
    pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
  },
};

const CANCEL = /<button type="submit" name="cancel" value="1" formnovalidate>/u;

const renderers = {
  'update-password': (variant?: 'requested') =>
    (variant === undefined ? renderUpdatePasswordPage : renderRequestedUpdatePasswordPage)(
      'acme',
      ADDRESS,
      's1',
      [],
      RULES,
      DEFAULT_PAGE_LOCALE,
    ),
  'configure-totp': (variant?: 'requested') =>
    (variant === undefined ? renderTotpEnrolmentPage : renderRequestedTotpEnrolmentPage)(
      'acme',
      ADDRESS,
      's1',
      TOTP,
      undefined,
      DEFAULT_PAGE_LOCALE,
    ),
  'configure-passkey': (variant?: 'requested') =>
    (variant === undefined ? renderPasskeyEnrolmentPage : renderRequestedPasskeyEnrolmentPage)(
      'acme',
      ADDRESS,
      's1',
      PASSKEY,
      undefined,
      DEFAULT_PAGE_LOCALE,
    ),
  'generate-recovery-codes': (variant?: 'requested') =>
    (variant === undefined ? renderRecoveryCodesPage : renderRequestedRecoveryCodesPage)(
      'acme',
      ADDRESS,
      's1',
      CODES,
      undefined,
      DEFAULT_PAGE_LOCALE,
    ),
};

describe('a page an application sent the person to', () => {
  for (const [action, render] of Object.entries(renderers)) {
    it(`${action} carries a cancel control in the same form, and the owed page does not`, () => {
      const requested = render('requested');
      expect(requested.body).toMatch(CANCEL);
      expect(requested.body).toContain('name="auth_session_id" value="s1"');
      expect(requested.body.match(/<form /gu)).toHaveLength(1);
      expect(render().body).not.toMatch(CANCEL);
      expect(render().body).not.toContain('name="cancel"');
    });
  }

  it('the passkey script leaves a cancel submission alone, and only on the requested page', () => {
    const guard = "event.submitter.name === 'cancel'";
    expect(renderers['configure-passkey']('requested').body).toContain(guard);
    expect(renderers['configure-passkey']().body).not.toContain(guard);
  });

  it('update-password asks for the current password only when requested', () => {
    expect(renderers['update-password']('requested').body).toContain(
      'name="current_password" autocomplete="current-password"',
    );
    expect(renderers['update-password']().body).not.toContain('current_password');
  });

  it('a refused current password is worded and marks its own field', () => {
    const page = renderRequestedUpdatePasswordPage(
      'acme',
      ADDRESS,
      's1',
      [{ rule: 'current-password', message: 'dev' }],
      RULES,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(en['updatePassword.rule.currentPassword']);
    expect(page.body).toMatch(/name="current_password"[^>]*aria-invalid="true"/u);
    expect(page.body).not.toMatch(/name="password"[^>]*aria-invalid/u);
  });

  it('says cancel in Arabic too', () => {
    for (const key of [
      'action.cancel',
      'updatePassword.currentPassword',
      'updatePassword.rule.currentPassword',
    ] as const) {
      expect(ar[key], key).toBeTruthy();
    }
    const page = renderRequestedUpdatePasswordPage('acme', ADDRESS, 's1', [], RULES, ARABIC);
    expect(page.body).toContain(ar['action.cancel']);
  });
});
