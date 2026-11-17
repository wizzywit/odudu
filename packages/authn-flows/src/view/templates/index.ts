import { type PageKind } from '@odudu/kernel';
import { ACCEPT_TERMS_TEMPLATE } from '#/view/templates/accept-terms';
import { PASSKEY_ENROLMENT_TEMPLATE } from '#/view/templates/passkey-enrolment';
import { RECOVERY_CODES_TEMPLATE } from '#/view/templates/recovery-codes';
import { REQUIRED_ACTION_TEMPLATE } from '#/view/templates/required-action';
import { TOTP_ENROLMENT_TEMPLATE } from '#/view/templates/totp-enrolment';
import { UPDATE_PASSWORD_TEMPLATE } from '#/view/templates/update-password';
import { UPDATE_PROFILE_TEMPLATE } from '#/view/templates/update-profile';
import { VERIFY_EMAIL_TEMPLATE } from '#/view/templates/verify-email';

export type TemplatedKind = Extract<
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

// What a page is filled with when no theme supplies a template for it.
export const DEFAULT_TEMPLATES: Record<TemplatedKind, string> = {
  'totp-enrolment': TOTP_ENROLMENT_TEMPLATE,
  'passkey-enrolment': PASSKEY_ENROLMENT_TEMPLATE,
  'recovery-codes': RECOVERY_CODES_TEMPLATE,
  'update-password': UPDATE_PASSWORD_TEMPLATE,
  'required-action': REQUIRED_ACTION_TEMPLATE,
  'verify-email': VERIFY_EMAIL_TEMPLATE,
  'update-profile': UPDATE_PROFILE_TEMPLATE,
  'accept-terms': ACCEPT_TERMS_TEMPLATE,
};
