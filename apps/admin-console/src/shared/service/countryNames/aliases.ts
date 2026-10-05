import aliases from '#/shared/service/countryNames/aliases.json';

// Other spellings of a stored country: the ISO 3166-1 catalogue forms, and
// names an older CLDR gave.
export const COUNTRY_ALIASES: Readonly<Record<string, string>> = aliases;
