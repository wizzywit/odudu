import { isValidLocale } from '@odudu/contracts';

// Languages on their own, then the regional forms most asked for; any other
// tag the server takes can be typed.
const TAGS = `
  af am ar az be bg bn bs ca cs cy da de el en es et eu fa fi fil fr ga gl gu ha he hi hr hu
  hy id ig is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ms mt my nb ne nl pa pl ps pt ro
  ru si sk sl so sq sr sv sw ta te th tk tr uk ur uz vi xh yo zh zu
  ar-AE ar-EG ar-MA ar-SA bn-BD bn-IN de-AT de-CH de-DE en-AU en-CA en-GB en-GH en-IE en-IN
  en-KE en-NG en-NZ en-PH en-SG en-US en-ZA es-419 es-AR es-CO es-ES es-MX es-US fr-BE fr-CA
  fr-CH fr-FR fr-SN ha-NG ig-NG it-CH it-IT nl-BE nl-NL pt-BR pt-PT sr-Cyrl sr-Latn sw-KE
  sw-TZ yo-NG zh-CN zh-HK zh-TW zh-Hans zh-Hant
`
  .trim()
  .split(/\s+/u);

export interface LocaleOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export function localeName(tag: string, display: string): string {
  const names = new Intl.DisplayNames([display, 'en'], {
    type: 'language',
    languageDisplay: 'standard',
    fallback: 'code',
  });
  try {
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

// `own` is the reader's locale, offered too when it is a shape the server takes.
export function localeOptions(display: string, own: string): readonly LocaleOption[] {
  const tags = isValidLocale(own) && !TAGS.includes(own) ? [...TAGS, own] : TAGS;
  return tags
    .map((tag) => ({ id: tag, label: localeName(tag, display), detail: tag }))
    .sort((a, b) => a.label.localeCompare(b.label, display));
}

export function localeProblem(value: string): string | null {
  return value === '' || isValidLocale(value)
    ? null
    : 'Choose a language, or type a tag such as en-NG.';
}
