import { type PageKind, type PasswordRules, type PreviewRender } from '@odudu/kernel';
import { renderRegistrationForm } from '#/view/registration-html';
import { renderRequiredActionsForm } from '#/view/required-actions-html';
import { renderResetPasswordForm, renderResetRequestedPage } from '#/view/reset-html';
import { renderEmailConfirmPage } from '#/view/verification-html';

type AccountKind = Extract<
  PageKind,
  'registration' | 'reset' | 'verification' | 'required-actions' | 'notice'
>;

const KEY = 'preview-key';

const RULES: PasswordRules = {
  minLength: 12,
  requireDigit: true,
  requireUppercase: true,
  requireLowercase: true,
  requireSpecial: false,
};

// Each kind of this package rendered by its own renderer with fixed sample
// values, for the theme preview. No value here is real or secret.
export const PREVIEW_PAGES: Readonly<Record<AccountKind, PreviewRender>> = {
  registration: (tenant, locale) =>
    renderRegistrationForm(tenant, { rules: RULES, signInPath: '#' }, locale),
  reset: (tenant, locale) => renderResetPasswordForm(tenant, KEY, undefined, RULES, locale),
  verification: (tenant, locale) => renderEmailConfirmPage(tenant, KEY, 'ada', locale),
  'required-actions': (tenant, locale) =>
    renderRequiredActionsForm(
      tenant,
      KEY,
      ['update-password', 'configure-totp'],
      true,
      undefined,
      RULES,
      locale,
    ),
  notice: (_tenant, locale) => renderResetRequestedPage('#', locale),
};
