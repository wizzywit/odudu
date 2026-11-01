import { type PageKind } from '@odudu/kernel';
import { FORM_PAGE_TEMPLATE } from '#/view/templates/form-page';
import { NOTICE_TEMPLATE } from '#/view/templates/notice';
import { REQUIRED_ACTIONS_TEMPLATE } from '#/view/templates/required-actions';
import { VERIFICATION_TEMPLATE } from '#/view/templates/verification';

export type TemplatedKind = Extract<
  PageKind,
  'registration' | 'reset' | 'verification' | 'required-actions' | 'notice'
>;

// What a page is filled with when no theme supplies a template for it.
export const DEFAULT_TEMPLATES: Record<TemplatedKind, string> = {
  registration: FORM_PAGE_TEMPLATE,
  reset: FORM_PAGE_TEMPLATE,
  verification: VERIFICATION_TEMPLATE,
  'required-actions': REQUIRED_ACTIONS_TEMPLATE,
  notice: NOTICE_TEMPLATE,
};
