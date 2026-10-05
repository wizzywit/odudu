import names from '#/shared/service/countryNames/names.json';

// The English name each region is stored under: the common short name
// ("South Korea", "Taiwan", "Türkiye"), pinned so that the address.country a
// relying party receives does not depend on the CLDR of the browser that
// saved it. Taken from CLDR 48's `en` territory names (unicode-org/cldr,
// common/main/en.xml), as ICU 78.2 in Node v24.15.0 gives them.
export const COUNTRY_NAMES_SOURCE = { cldr: '48', locale: 'en' } as const;

export const COUNTRY_NAMES: Readonly<Record<string, string>> = names;
