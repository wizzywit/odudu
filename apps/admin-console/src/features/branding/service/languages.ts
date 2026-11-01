import { LOCALISED_TEXT_ENTRIES_MAX } from '@odudu/contracts';
import { MAIL_PREVIEW_LOCALES, type AmendSettingsRequest } from '@odudu/contracts/admin';
import { languageChoices, localeProblem } from '#/shared/service/locales';
import { uniqueIds } from '#/shared/service/ids';
import { offeredLocales } from '#/shared/service/offeredLocales';
import type { Choice } from '#/shared/service/choice';
import type { SectionFields } from '#/shared/service/sectionSave';

// The languages this build holds a catalogue for; a test in packages/email
// holds the list equal to the i18n package's SHIPPED_LOCALES.
export const SHIPPED_LANGUAGES: readonly string[] = MAIL_PREVIEW_LOCALES;

export const LANGUAGES_SECTION = 'languages';

export const LANGUAGES_TITLE = 'Languages';

export const LANGUAGES_DESCRIPTION =
  'The languages the tenant’s pages and mail are offered in, and the one used when a visitor’s browser does not decide.';

export const SUPPORTED_LABEL = 'Supported languages';

export const ADD_LABEL = 'Add a language';

export const SUPPORTED_NOTE = `A language the build ships with is complete. Any other the tenant already offers stays listed, and “${ADD_LABEL}” below adds one; its pages use the English text unless a message override says otherwise.`;

export const DEFAULT_LABEL = 'Default language';

export const DEFAULT_NOTE =
  'Used ahead of the browser’s preference, when the request names no language.';

export const ADD_NOTE =
  'Choose a language or type its tag, such as fr or pt-BR. Its pages use the English text unless a message override says otherwise.';

export const ADD_BUTTON = 'Add language';

export const ADD_NEEDED = 'Choose a language, or type a tag such as fr-CA.';

export const ADD_DUPLICATE = 'That language is already offered.';

export const ADD_FULL = `A tenant offers at most ${String(LOCALISED_TEXT_ENTRIES_MAX)} languages.`;

export const BROWSER_DECIDES = 'The browser decides';

export interface LanguageValues extends Readonly<Record<string, unknown>> {
  supported_locales: readonly string[];
  default_locale: string;
}

export interface LanguageSettings {
  supported_locales: readonly string[];
  default_locale: string | null;
}

// The two settings out of the whole record, which the contract types loosely.
export function languageSettingsOf(settings: Readonly<Record<string, unknown>>): LanguageSettings {
  const fallback = settings.default_locale;
  return {
    supported_locales: offeredLocales(settings),
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

// The section's fields as the save reads them: the label a conflict or a
// restored draft names, and how a value reads aloud.
export function languageFields(base: LanguageValues): SectionFields<LanguageValues> {
  return {
    supported_locales: {
      value: base.supported_locales,
      label: SUPPORTED_LABEL,
      kind: 'plain',
      describe: (value) => (Array.isArray(value) ? value.join(', ') : ''),
    },
    default_locale: {
      value: base.default_locale,
      label: DEFAULT_LABEL,
      kind: 'plain',
      describe: (value) => (value === '' ? DEFAULT_NONE : String(value)),
    },
  };
}

export interface Added {
  // The supported languages with the new one, or null when it is refused.
  supported: string[] | null;
  problem: string | null;
}

// A typed or chosen tag joined to the supported languages, or why it cannot.
export function languageAdded(supported: readonly string[], text: string): Added {
  const tag = text.trim();
  const problem = tag === '' ? ADD_NEEDED : localeProblem(tag);
  if (problem !== null) return { supported: null, problem };
  if (supported.some((held) => held.toLowerCase() === tag.toLowerCase())) {
    return { supported: null, problem: ADD_DUPLICATE };
  }
  if (supported.length >= LOCALISED_TEXT_ENTRIES_MAX) return { supported: null, problem: ADD_FULL };
  return { supported: [...supported, tag], problem: null };
}

export interface AddedTo {
  // The problem with what was typed, or undefined to clear one shown.
  problem: (problem: string | undefined) => void;
  accepted: (supported: string[]) => void;
}

// Adds what was typed, or says why it cannot be.
export function addLanguage(supported: readonly string[], text: string, to: AddedTo): void {
  const added = languageAdded(supported, text);
  to.problem(added.problem ?? undefined);
  if (added.supported !== null) to.accepted(added.supported);
}

// Enter adds the typed tag, unless it is choosing an option the list points at
// that is not the one already chosen.
export function addsOnKey(key: string, choosing: boolean): boolean {
  return key === 'Enter' && !choosing;
}
