import { MAIL_PREVIEW_LOCALES, type AmendSettingsRequest } from '@odudu/contracts/admin';
import { languageChoices } from '#/shared/services/locales';
import { uniqueIds } from '#/shared/services/ids';
import type { Choice } from '#/shared/services/choice';
import { ADD_LABEL } from '#/pages/branding/services/addedLanguage';

// The languages this build holds a catalogue for; a test in packages/email
// holds the list equal to the i18n package's SHIPPED_LOCALES.
export const SHIPPED_LANGUAGES: readonly string[] = MAIL_PREVIEW_LOCALES;

export const SUPPORTED_LABEL = 'Supported languages';

export const SUPPORTED_NOTE = `A language the build ships with is complete. Any other the tenant already offers stays listed, and “${ADD_LABEL}” below adds one; its pages use the English text unless a message override says otherwise.`;

export const DEFAULT_LABEL = 'Default language';

export const DEFAULT_NOTE =
  'Used ahead of the browser’s preference, when the request names no language.';

export const BROWSER_DECIDES = 'The browser decides';

export interface LanguageValues extends Readonly<Record<string, unknown>> {
  supported_locales: readonly string[];
  default_locale: string;
}

export interface LanguageSettings {
  supported_locales: readonly string[];
  default_locale: string | null;
}

// The two settings out of the whole record, which the contract types loosely;
// `supported` is the languages the tenant offers, read by the tenant entity.
export function languageSettingsOf(
  settings: Readonly<Record<string, unknown>>,
  supported: readonly string[],
): LanguageSettings {
  const fallback = settings.default_locale;
  return {
    supported_locales: supported,
    default_locale: typeof fallback === 'string' && fallback !== '' ? fallback : null,
  };
}

export function languagesOf(settings: LanguageSettings): LanguageValues {
  return {
    supported_locales: settings.supported_locales,
    default_locale: settings.default_locale ?? '',
  };
}

// The shipped languages, then every other the tenant offers or is adding,
// each once.
export function languageTags(...offered: readonly (readonly string[])[]): string[] {
  return uniqueIds([...SHIPPED_LANGUAGES, ...offered.flat()]);
}

// Saved languages stay listed when unticked, so a tick can be undone; one
// that was added and never saved is listed only while ticked.
export function supportedChoices(saved: readonly string[], edited: readonly string[]): Choice[] {
  return languageChoices(languageTags(saved, edited));
}

export function defaultChoices(supported: readonly string[]): Choice[] {
  return [{ id: '', label: BROWSER_DECIDES }, ...languageChoices(supported)];
}

export const NONE_SUPPORTED = 'Offer at least one language.';

export const DEFAULT_NOT_SUPPORTED = 'The default language must be one of the supported languages.';

// Why the section cannot be saved, or undefined when it can.
export function languagesHold(values: LanguageValues): string | undefined {
  if (values.supported_locales.length === 0) return NONE_SUPPORTED;
  return values.default_locale !== '' && !values.supported_locales.includes(values.default_locale)
    ? DEFAULT_NOT_SUPPORTED
    : undefined;
}

// Only what changed is sent. An empty default is what the settings take to
// clear it, so the browser decides again.
export function languagesRequest(changes: Partial<LanguageValues>): AmendSettingsRequest {
  return {
    ...(changes.supported_locales === undefined
      ? {}
      : { supported_locales: [...changes.supported_locales] }),
    ...(changes.default_locale === undefined ? {} : { default_locale: changes.default_locale }),
  };
}

// The tags a message override can be written for: the supported ones.
export function overrideLocales(supported: readonly string[]): Choice[] {
  return languageChoices(supported);
}

// The language the overrides open on: the default if it is offered, else the first.
export function openingLocale(settings: LanguageSettings): string {
  const { default_locale: fallback, supported_locales: supported } = settings;
  return fallback !== null && supported.includes(fallback) ? fallback : (supported[0] ?? 'en');
}

export const DEFAULT_NONE = 'the browser decides';
