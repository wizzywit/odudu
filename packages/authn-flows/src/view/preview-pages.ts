import { pathAddress, type PageKind, type PreviewRender } from '@odudu/kernel';
import { renderPasskeyEnrolmentPage } from '#/view/passkey-enrolment-html';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';
import { renderRequiredActionPage } from '#/view/required-action-html';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';
import { renderAcceptTermsPage } from '#/view/accept-terms-html';
import { renderUpdatePasswordPage } from '#/view/update-password-html';
import { renderUpdateProfilePage } from '#/view/update-profile-html';
import { renderVerifyEmailPage } from '#/view/verify-email-html';

type AuthnKind = Extract<
  PageKind,
  | 'totp-enrolment'
  | 'passkey-enrolment'
  | 'recovery-codes'
  | 'update-password'
  | 'required-action'
  | 'verify-email'
  | 'update-profile'
  | 'accept-terms'
>;

const SESSION = 'preview-session';

// Each kind of this package rendered by its own renderer with fixed sample
// values, for the theme preview. No value here is real or secret.
export const PREVIEW_PAGES: Readonly<Record<AuthnKind, PreviewRender>> = {
  'totp-enrolment': (tenant, locale) =>
    renderTotpEnrolmentPage(
      tenant,
      pathAddress('', tenant),
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
      pathAddress('', tenant),
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
      pathAddress('', tenant),
      SESSION,
      { codes: ['ab12-cd34', 'ef56-gh78', 'jk90-lm12', 'np34-qr56'], replaced: false },
      undefined,
      locale,
    ),
  'update-password': (tenant, locale) =>
    renderUpdatePasswordPage(
      tenant,
      pathAddress('', tenant),
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
  'verify-email': (tenant, locale) =>
    renderVerifyEmailPage(
      tenant,
      pathAddress('', tenant),
      SESSION,
      { email: 'ada@example.com', verified: false },
      undefined,
      locale,
    ),
  'update-profile': (tenant, locale) =>
    renderUpdateProfilePage(
      tenant,
      pathAddress('', tenant),
      SESSION,
      {
        fields: ['name', 'given_name', 'family_name', 'birthdate', 'phone_number'],
        required: ['given_name', 'family_name'],
        values: {
          name: 'Ada Example',
          given_name: 'Ada',
          family_name: '',
          birthdate: '',
          phone_number: '',
        },
      },
      [],
      locale,
    ),
  'accept-terms': (tenant, locale) =>
    renderAcceptTermsPage(
      tenant,
      pathAddress('', tenant),
      SESSION,
      { uri: 'https://example.com/terms', version: '1' },
      undefined,
      locale,
    ),
  'required-action': (_tenant, locale) =>
    renderRequiredActionPage('configure-passkey', '#', locale),
};
