import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequestedPasskeyEnrolmentPage,
  renderRequestedRecoveryCodesPage,
  renderRequestedTotpEnrolmentPage,
  renderRequestedUpdatePasswordPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  type ActionPageVariant,
} from '@odudu/authn-flows';

export interface ActionPages {
  readonly updatePassword: typeof renderUpdatePasswordPage;
  readonly totp: typeof renderTotpEnrolmentPage;
  readonly passkey: typeof renderPasskeyEnrolmentPage;
  readonly recoveryCodes: typeof renderRecoveryCodesPage;
}

const OWED: ActionPages = {
  updatePassword: renderUpdatePasswordPage,
  totp: renderTotpEnrolmentPage,
  passkey: renderPasskeyEnrolmentPage,
  recoveryCodes: renderRecoveryCodesPage,
};

const REQUESTED: ActionPages = {
  updatePassword: renderRequestedUpdatePasswordPage,
  totp: renderRequestedTotpEnrolmentPage,
  passkey: renderRequestedPasskeyEnrolmentPage,
  recoveryCodes: renderRequestedRecoveryCodesPage,
};

// The pages of the actions a tenant owes, which cannot be left, or of the
// same actions an application sent the person to, which can.
export function actionPages(variant: ActionPageVariant | undefined): ActionPages {
  return variant === 'requested' ? REQUESTED : OWED;
}
