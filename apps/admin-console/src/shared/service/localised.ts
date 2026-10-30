import { languageLabel } from '#/shared/service/locales';
import { andList } from '#/shared/service/format';
import { uniqueIds } from '#/shared/service/ids';
import type { Read } from '#/shared/service/read';

// Text by language tag, as a client's name or a scope's description is kept.
export type Translations = Readonly<Record<string, string>>;

export const LOADING_LANGUAGES = 'Loading the languages the tenant offers…';

export const LANGUAGES_REFUSED =
  'Listing the languages the tenant offers needs the manage-tenant capability. Only languages that already have text are shown.';

export const LANGUAGES_FAILED = 'The languages the tenant offers could not be loaded.';

export const NONE_TRANSLATED = 'Nothing is translated: every language shows the text above.';

export const NOT_OFFERED =
  'The tenant no longer offers this language. Saving keeps the text; clear it to remove it.';

// A language per tab: those the tenant offers, then any the map holds that it
// does not, so text written under a language since dropped can still be cleared.
export function translationTabs(offered: readonly string[], map: Translations): string[] {
  return uniqueIds([...offered, ...Object.keys(map)]);
}

export function isTranslated(map: Translations, tag: string): boolean {
  return (map[tag] ?? '').trim() !== '';
}

// The map with one language's text set; text that is blank removes the entry,
// since the server answers a language with no entry from the base text.
export function withTranslation(map: Translations, tag: string, text: string): Translations {
  const others = Object.entries(map).filter(([each]) => each !== tag);
  return Object.fromEntries(text.trim() === '' ? others : [...others, [tag, text]]);
}

// Not a live region: it changes with every keystroke, which would be announced
// one letter at a time.
export function translatedSummary(map: Translations): string {
  const tags = Object.keys(map).filter((tag) => isTranslated(map, tag));
  if (tags.length === 0) return NONE_TRANSLATED;
  return `Translated: ${andList(tags.map(languageLabel))}. Every other language shows the text above.`;
}

// What to say in place of the tabs while the offered languages are not known.
export function languagesNote(read: Read<string[]>): string | null {
  if (read.status === 'ready') return null;
  if (read.status === 'loading') return LOADING_LANGUAGES;
  return read.refused ? LANGUAGES_REFUSED : LANGUAGES_FAILED;
}

export function offeredOf(read: Read<string[]>): string[] {
  return read.status === 'ready' ? read.data : [];
}

export function offersTag(read: Read<string[]>, tag: string): boolean {
  return read.status !== 'ready' || read.data.includes(tag);
}

// A map as a conflict panel names it: the languages it holds text for.
export function describeTranslations(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'none';
  const tags = Object.keys(value);
  return tags.length === 0 ? 'none' : tags.join(', ');
}
