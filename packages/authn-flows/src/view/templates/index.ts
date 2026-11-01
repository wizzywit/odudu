import { type PageKind } from '@odudu/kernel';
import { PASSKEY_ENROLMENT_TEMPLATE } from '#/view/templates/passkey-enrolment';
import { RECOVERY_CODES_TEMPLATE } from '#/view/templates/recovery-codes';
import { REQUIRED_ACTION_TEMPLATE } from '#/view/templates/required-action';
import { TOTP_ENROLMENT_TEMPLATE } from '#/view/templates/totp-enrolment';
import { UPDATE_PASSWORD_TEMPLATE } from '#/view/templates/update-password';

export type TemplatedKind = Extract<
  PageKind,
  'totp-enrolment' | 'passkey-enrolment' | 'recovery-codes' | 'update-password' | 'required-action'
>;

// What a page is filled with when no theme supplies a template for it.
export const DEFAULT_TEMPLATES: Record<TemplatedKind, string> = {
  'totp-enrolment': TOTP_ENROLMENT_TEMPLATE,
  'passkey-enrolment': PASSKEY_ENROLMENT_TEMPLATE,
  'recovery-codes': RECOVERY_CODES_TEMPLATE,
  'update-password': UPDATE_PASSWORD_TEMPLATE,
  'required-action': REQUIRED_ACTION_TEMPLATE,
};
