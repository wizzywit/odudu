import { MAIL_PREVIEW_LOCALES } from '@odudu/contracts/admin';
import type { Choice } from '#/shared/services/choice';
import { languageChoices } from '#/shared/services/locales';

export const MAIL_LOCALE_LABEL = 'Language';

export const TENANT_DEFAULT_LANGUAGE = 'The tenant’s default';

export const MAIL_LOCALE_OPTIONS: readonly Choice[] = [
  { id: '', label: TENANT_DEFAULT_LANGUAGE },
  ...languageChoices(MAIL_PREVIEW_LOCALES),
];

export function mailLocaleOf(id: string): string | undefined {
  return MAIL_LOCALE_OPTIONS.find((option) => option.id === id)?.id;
}

// What the preview strip calls the mail it shows.
export const MAIL_SUMMARY_NAME = 'Email';

export function mailLocaleLabel(id: string): string {
  return MAIL_LOCALE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
