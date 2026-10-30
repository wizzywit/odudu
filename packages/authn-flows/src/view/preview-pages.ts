import { type PageKind, type PreviewRender } from '@odudu/kernel';
import { renderPasskeyEnrolmentPage } from '#/view/passkey-enrolment-html';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';
import { renderRequiredActionPage } from '#/view/required-action-html';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';
import { renderUpdatePasswordPage } from '#/view/update-password-html';

type AuthnKind = Extract<
  PageKind,
  'totp-enrolment' | 'passkey-enrolment' | 'recovery-codes' | 'update-password' | 'required-action'
>;

const SESSION = 'preview-session';

// Each kind of this package rendered by its own renderer with fixed sample
// values, for the theme preview. No value here is real or secret.
export const PREVIEW_PAGES: Readonly<Record<AuthnKind, PreviewRender>> = {
  'totp-enrolment': (tenant, locale) =>
    renderTotpEnrolmentPage(
      tenant,
      SESSION,
      {
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/Example:ada?secret=JBSWY3DPEHPK3PXP&issuer=Example',
      },
      undefined,
      locale,
    ),
  'passkey-enrolment': (tenant, locale) =>
    renderPasskeyEnrolmentPage(
      tenant,
      SESSION,
      {
        options: {
          challenge: 'cHJldmlldw',
          rp: { name: 'Example', id: 'example.com' },
          user: { id: 'cHJldmlldw', name: 'ada', displayName: 'Ada Example' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
      },
      undefined,
      locale,
    ),
  'recovery-codes': (tenant, locale) =>
    renderRecoveryCodesPage(
      tenant,
      SESSION,
      { codes: ['ab12-cd34', 'ef56-gh78', 'jk90-lm12', 'np34-qr56'], replaced: false },
      undefined,
      locale,
    ),
  'update-password': (tenant, locale) =>
    renderUpdatePasswordPage(
      tenant,
      SESSION,
      [],
      {
        minLength: 12,
        requireDigit: true,
        requireUppercase: true,
        requireLowercase: true,
        requireSpecial: false,
      },
      locale,
    ),
  'required-action': (_tenant, locale) =>
    renderRequiredActionPage('configure-passkey', '#', locale),
};
