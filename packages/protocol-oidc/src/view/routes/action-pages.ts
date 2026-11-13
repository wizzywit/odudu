import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequestedPasskeyEnrolmentPage,
  renderRequestedRecoveryCodesPage,
  renderRequestedTotpEnrolmentPage,
  renderRequestedUpdatePasswordPage,
  renderRequestedUpdateProfilePage,
  renderRequestedVerifyEmailPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  renderUpdateProfilePage,
  renderVerifyEmailPage,
  type ActionPageVariant,
} from '@odudu/authn-flows';

export interface ActionPages {
  readonly updatePassword: typeof renderUpdatePasswordPage;
  readonly totp: typeof renderTotpEnrolmentPage;
  readonly passkey: typeof renderPasskeyEnrolmentPage;
  readonly recoveryCodes: typeof renderRecoveryCodesPage;
  readonly verifyEmail: typeof renderVerifyEmailPage;
  readonly updateProfile: typeof renderUpdateProfilePage;
}

const OWED: ActionPages = {
  updatePassword: renderUpdatePasswordPage,
  totp: renderTotpEnrolmentPage,
  passkey: renderPasskeyEnrolmentPage,
  recoveryCodes: renderRecoveryCodesPage,
  verifyEmail: renderVerifyEmailPage,
  updateProfile: renderUpdateProfilePage,
};

const REQUESTED: ActionPages = {
  updatePassword: renderRequestedUpdatePasswordPage,
  totp: renderRequestedTotpEnrolmentPage,
  passkey: renderRequestedPasskeyEnrolmentPage,
  recoveryCodes: renderRequestedRecoveryCodesPage,
  verifyEmail: renderRequestedVerifyEmailPage,
  updateProfile: renderRequestedUpdateProfilePage,
};

// The pages of the actions a tenant owes, which cannot be left, or of the
// same actions an application sent the person to, which can.
export function actionPages(variant: ActionPageVariant | undefined): ActionPages {
  return variant === 'requested' ? REQUESTED : OWED;
}
