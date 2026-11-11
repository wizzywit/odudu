// The OIDC Core §5.1 claim shapes live in @odudu/contracts, where the
// console reads them too; profile.int.test.ts proves the CHECK constraints
// of packages/db/drizzle/0020_user_profile.sql agree with them.
import {
  isValidBirthdate,
  isValidE164,
  isValidLocale,
  isValidProfileUrl,
  isValidZoneinfo,
} from '@odudu/contracts';

export { isValidBirthdate, isValidE164, isValidLocale, isValidProfileUrl, isValidZoneinfo };

// Every claim a person or an operator may write as a string, by the snake_case
// name a wire shape carries and the column key `updateProfile` takes. The
// verification flags and the identity columns are not claims in this sense.
export type StringClaimKey =
  | 'name'
  | 'givenName'
  | 'familyName'
  | 'middleName'
  | 'nickname'
  | 'preferredUsername'
  | 'profile'
  | 'picture'
  | 'website'
  | 'gender'
  | 'birthdate'
  | 'zoneinfo'
  | 'locale'
  | 'phoneNumber'
  | 'addressFormatted'
  | 'addressStreet'
  | 'addressLocality'
  | 'addressRegion'
  | 'addressPostalCode'
  | 'addressCountry';

export const CLAIM_KEY: Readonly<Record<string, StringClaimKey>> = {
  name: 'name',
  given_name: 'givenName',
  family_name: 'familyName',
  middle_name: 'middleName',
  nickname: 'nickname',
  preferred_username: 'preferredUsername',
  profile: 'profile',
  picture: 'picture',
  website: 'website',
  gender: 'gender',
  birthdate: 'birthdate',
  zoneinfo: 'zoneinfo',
  locale: 'locale',
  phone_number: 'phoneNumber',
  address_formatted: 'addressFormatted',
  address_street: 'addressStreet',
  address_locality: 'addressLocality',
  address_region: 'addressRegion',
  address_postal_code: 'addressPostalCode',
  address_country: 'addressCountry',
};

const URL_FIELDS = new Set(['profile', 'picture', 'website']);

// Why a value has not the shape its claim needs, or null: a friendly refusal
// instead of a caller learning of `users_birthdate_shape` from a 500.
// `phone_number`'s own E.164 requirement is conditional on its verified flag,
// so it is not checked here.
export function shapeInvalidityFor(field: string, value: string): string | null {
  if (field === 'birthdate' && !isValidBirthdate(value)) {
    return `${JSON.stringify(value)} is not a birthdate the claim may carry (YYYY-MM-DD, or YYYY alone)`;
  }
  if (field === 'zoneinfo' && !isValidZoneinfo(value)) {
    return `${JSON.stringify(value)} is not an IANA Time Zone Database name`;
  }
  if (field === 'locale' && !isValidLocale(value)) {
    return `${JSON.stringify(value)} is not a BCP 47 locale the claim may carry`;
  }
  if (URL_FIELDS.has(field) && !isValidProfileUrl(value)) {
    return `${JSON.stringify(value)} is not an http or https URL`;
  }
  return null;
}
