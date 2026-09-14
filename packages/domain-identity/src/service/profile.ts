// OIDC Core §5.1 claim shapes. Mirrored in the CHECK constraints of
// packages/db/drizzle/0020_user_profile.sql; profile.int.test.ts holds the
// two spellings in agreement, as email.ts and users_email_addr_spec are.

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

// profile, picture and website are rendered as links by consumers, so they
// are constrained to the schemes a link can safely use.
const HTTP_URL = /^https?:\/\//u;

export function isValidBirthdate(value: string): boolean {
  return BIRTHDATE.test(value);
}

export function isValidZoneinfo(value: string): boolean {
  return ZONEINFO.test(value);
}

export function isValidLocale(value: string): boolean {
  return LOCALE.test(value);
}

export function isValidProfileUrl(value: string): boolean {
  return HTTP_URL.test(value);
}
