import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { ar, en } from '#/view/messages';
import {
  renderPasskeyEnrolmentPage,
  renderRequestedPasskeyEnrolmentPage,
} from '#/view/passkey-enrolment-html';
import {
  renderRecoveryCodesPage,
  renderRecoveryCodesTooSoonPage,
  renderRequestedRecoveryCodesConfirmPage,
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

  it('says why the person is here, not that the account needs a new password', () => {
    const owed = renderers['update-password']().body;
    const requested = renderers['update-password']('requested').body;
    expect(owed).toContain(en['updatePassword.intro']);
    expect(requested).not.toContain(en['updatePassword.intro']);
    expect(requested).toContain(en['updatePassword.requestedIntro']);
    expect(ar['updatePassword.requestedIntro']).toBeTruthy();
  });

  it('the recovery-code confirmation names the replacement and carries a confirm and a cancel', () => {
    const page = renderRequestedRecoveryCodesConfirmPage(
      'acme',
      ADDRESS,
      's1',
      true,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(en['recoveryCodes.confirmReplace']);
    expect(page.body).toContain('name="confirm" value="1"');
    expect(page.body).toMatch(CANCEL);
    expect(page.body).not.toContain('<ol>');
    expect(ar['recoveryCodes.confirmReplace']).toBeTruthy();
    expect(ar['recoveryCodes.confirm']).toBeTruthy();
  });

  it('the confirmation for a person with no set offers to create one, not to replace', () => {
    const page = renderRequestedRecoveryCodesConfirmPage(
      'acme',
      ADDRESS,
      's1',
      false,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain(en['recoveryCodes.confirmIssue']);
    expect(page.body).toContain(en['recoveryCodes.confirmCreate']);
    expect(page.body).not.toContain(en['recoveryCodes.confirmReplace']);
    expect(page.body).toContain('name="confirm" value="1"');
    expect(page.body).toMatch(CANCEL);
    expect(ar['recoveryCodes.confirmIssue']).toBeTruthy();
    expect(ar['recoveryCodes.confirmCreate']).toBeTruthy();
  });

  it('the refusal names the wait in minutes and shows no codes', () => {
    const page = renderRecoveryCodesTooSoonPage(
      'acme',
      ADDRESS,
      's1',
      23,
      undefined,
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('23 minutes');
    expect(page.body).not.toContain('<ol>');
    expect(page.body).not.toContain('name="confirm"');
    expect(page.body).not.toMatch(CANCEL);
    expect(ar['recoveryCodes.tooSoon']).toBeTruthy();
  });

  it('the refusal of a requested action can be left, and a lone minute is singular', () => {
    const page = renderRecoveryCodesTooSoonPage(
      'acme',
      ADDRESS,
      's1',
      1,
      'requested',
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.body).toContain('1 minute.');
    expect(page.body).toMatch(CANCEL);
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
