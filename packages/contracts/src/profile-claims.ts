// OIDC Core §5.1 claim shapes. @odudu/domain-identity re-exports these, the
// CHECK constraints of packages/db/drizzle/0020_user_profile.sql repeat them
// (profile.int.test.ts holds the two in agreement), and the console checks
// a value with these same predicates before it sends one.

// YYYY-MM-DD, or YYYY alone when only the year is known. '0000' is the
// permitted year for a birthdate that withholds it, so this must not
// require a plausible year.
const BIRTHDATE = /^[0-9]{4}(-[0-9]{2}-[0-9]{2})?$/u;

// An IANA Time Zone Database name: a slash-separated path of segments, each
// starting with a letter.
const ZONEINFO = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/u;

// BCP 47: a 2-3 letter language subtag, an optional 4-letter script subtag,
// an optional 2-letter region or 3-digit region subtag.
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$/u;

// The same shape as a pattern a published schema can carry.
export const LOCALE_PATTERN = LOCALE.source;

// profile, picture and website are rendered as links by consumers, so they
// are constrained to the schemes a link can safely use.
const HTTP_URL = /^https?:\/\//u;

// E.164, optionally RFC 3966-extended — the shape
// `users_verified_phone_is_e164` (packages/db/drizzle/
// 0024_verified_phone_is_e164.sql) requires once `phone_number_verified`
// is true, and only then; an unverified number carries no shape at all.
const E164 = /^\+[1-9][0-9]{1,14}(;ext=[0-9]+)?$/u;

export function isValidBirthdate(value: string): boolean {
  return BIRTHDATE.test(value);
}

export function isValidZoneinfo(value: string): boolean {
  return ZONEINFO.test(value);
}

export function isValidLocale(value: string): boolean {
  return LOCALE.test(value);
}

// The spelling RFC 5646 §2.1.1 recommends: the language in lower case, a
// script in title case, a region in upper case. Null when `isValidLocale`
// refuses the tag, so a stored tag has one spelling whatever was typed.
export function canonicalLocale(value: string): string | null {
  if (!LOCALE.test(value)) return null;
  const [language = '', ...rest] = value.split('-');
  const subtags = rest.map((subtag) => {
    if (subtag.length === 4)
      return subtag.slice(0, 1).toUpperCase() + subtag.slice(1).toLowerCase();
    return subtag.toUpperCase();
  });
  return [language.toLowerCase(), ...subtags].join('-');
}

export function isValidProfileUrl(value: string): boolean {
  return HTTP_URL.test(value);
}

export function isValidE164(value: string): boolean {
  return E164.test(value);
}
