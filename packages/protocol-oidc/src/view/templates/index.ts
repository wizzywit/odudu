import { type PageKind } from '@odudu/kernel';
import { AUTHORIZE_ERROR_TEMPLATE } from '#/view/templates/authorize-error';
import { CONSENT_TEMPLATE } from '#/view/templates/consent';
import { EMAIL_UNVERIFIED_TEMPLATE } from '#/view/templates/email-unverified';
import { LOGGED_OUT_TEMPLATE } from '#/view/templates/logged-out';
import { LOGOUT_CONFIRM_TEMPLATE } from '#/view/templates/logout-confirm';
import { SELECT_ACCOUNT_TEMPLATE } from '#/view/templates/select-account';
import { SIGN_IN_TEMPLATE } from '#/view/templates/sign-in';

export type TemplatedKind = Extract<
  PageKind,
  | 'sign-in'
  | 'consent'
  | 'select-account'
  | 'logout-confirm'
  | 'authorize-error'
  | 'email-unverified'
  | 'logged-out'
>;

// What a page is filled with when no theme supplies a template for it.
export const DEFAULT_TEMPLATES: Record<TemplatedKind, string> = {
  'sign-in': SIGN_IN_TEMPLATE,
  consent: CONSENT_TEMPLATE,
  'select-account': SELECT_ACCOUNT_TEMPLATE,
  'logout-confirm': LOGOUT_CONFIRM_TEMPLATE,
  'authorize-error': AUTHORIZE_ERROR_TEMPLATE,
  'email-unverified': EMAIL_UNVERIFIED_TEMPLATE,
  'logged-out': LOGGED_OUT_TEMPLATE,
};
