import { COUNTRY_ALIASES, COUNTRY_NAMES } from '#/shared/service/countryNames.ts';

// ISO 3166-1 alpha-2 regions, and XK, which CLDR names Kosovo.
export interface Region {
  code: string;
}

export const REGIONS: readonly Region[] = Object.keys(COUNTRY_NAMES).map((code) => ({ code }));

// OIDC Core §5.1.1 gives address.country as a name, so the pinned English
// one is what is stored, whatever language the list is shown in.
export function englishCountryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

const CLDR_ENGLISH = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

function key(name: string): string {
  return name.trim().toLowerCase().replaceAll('’', "'");
}

// A stored name resolves if it is the pinned one, an older spelling, or the
// name this browser's CLDR gives.
const BY_NAME = new Map<string, string>([
  ...REGIONS.map(({ code }): [string, string] => [key(CLDR_ENGLISH.of(code) ?? code), code]),
  ...Object.entries(COUNTRY_ALIASES).map(([name, code]): [string, string] => [key(name), code]),
  ...REGIONS.map(({ code }): [string, string] => [key(englishCountryName(code)), code]),
]);

export function regionOfCountryName(name: string): string | null {
  return BY_NAME.get(key(name)) ?? null;
}

export interface NamedRegion {
  id: string;
  label: string;
}

export function countryOptions(locale: string): readonly NamedRegion[] {
  const names = new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'code' });
  return REGIONS.map(({ code }) => ({ id: code, label: names.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}
