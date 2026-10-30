import { CLIENT_NAME_MAX } from '@odudu/contracts/admin';
import { DESCRIPTION_MAX } from '#/shared/service/labels';
import type { Translations } from '#/shared/service/localised';
import type { Read } from '#/shared/service/read';

export const TRANSLATIONS_LEAD =
  'How the client is named in another language, on the consent screen and wherever else a person meets it. A language left empty shows the name and description above.';

export const NAME_TRANSLATIONS_LABEL = 'Name';
export const NAME_TRANSLATIONS_NOTE = `At most ${String(CLIENT_NAME_MAX)} characters in each language.`;
export const DESCRIPTION_TRANSLATIONS_LABEL = 'Description';
export const DESCRIPTION_TRANSLATIONS_NOTE = `At most ${String(DESCRIPTION_MAX)} characters in each language.`;

export const NAME_TRANSLATIONS_FIELD = 'Name in other languages';
export const DESCRIPTION_TRANSLATIONS_FIELD = 'Description in other languages';

export interface TranslationValues {
  name_i18n?: Translations;
  description_i18n?: Translations;
}

// A map is replaced whole by a PATCH, so one is sent only when it was edited.
export function translationsPatch(changes: TranslationValues): TranslationValues {
  return {
    ...(changes.name_i18n === undefined ? {} : { name_i18n: changes.name_i18n }),
    ...(changes.description_i18n === undefined
      ? {}
      : { description_i18n: changes.description_i18n }),
  };
}

// The languages the client's own record says the tenant offers.
export function offeredBy(client: { supported_locales: readonly string[] }): Read<string[]> {
  return { status: 'ready', data: [...client.supported_locales] };
}
