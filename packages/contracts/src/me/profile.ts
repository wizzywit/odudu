import { z } from 'zod';
import { profileSchema } from '#/admin/profile';

// The claims, described once for the shapes a person reads. A claim is the
// OpenID Connect Core 5.1 claim of the same name; null means it is not set.
export const CLAIM_WORDS = {
  name: 'The full name, as the person writes it. Null when not set.',
  given_name: 'The first name. Null when not set.',
  family_name: 'The last name. Null when not set.',
  middle_name: 'The middle name. Null when not set.',
  nickname: 'A casual name. Null when not set.',
  preferred_username:
    'The name the person prefers to be addressed by. It is separate from `username`, which signs them in. Null when not set.',
  profile: 'The address of the person’s profile page. Null when not set.',
  picture: 'The address of the person’s picture. Null when not set.',
  website: 'The address of the person’s web page. Null when not set.',
  gender: 'The person’s gender, in their own words. Null when not set.',
  birthdate: 'The birth date as `YYYY-MM-DD`, or `YYYY` alone. Null when not set.',
  zoneinfo: 'The time zone as an IANA name, such as `Europe/Berlin`. Null when not set.',
  locale: 'The preferred language as a BCP 47 tag, such as `en-GB`. Null when not set.',
  phone_number: 'The telephone number, ideally in E.164 form. Null when not set.',
  address_formatted: 'The whole postal address as one multi-line string. Null when not set.',
  address_street: 'The street address. Null when not set.',
  address_locality: 'The city or locality. Null when not set.',
  address_region: 'The state, province or region. Null when not set.',
  address_postal_code: 'The postal code. Null when not set.',
  address_country: 'The country. Null when not set.',
} as const;

// The profile claims as the admin API states them, with who the person is.
// Each claim is described again here, because the admin descriptions are
// attached to its document and not to the schema.
export const meProfileSchema = profileSchema.extend({
  sub: z.string().describe('The person’s stable identifier in this tenant. It never changes.'),
  username: z
    .string()
    .describe(
      'The name the person signs in with, unique in the tenant. It can be changed only where the tenant allows it.',
    ),
  email: z
    .string()
    .nullable()
    .describe(
      'The email address. Null when none is set. It changes only once the person follows the link mailed to the new address.',
    ),
  name: profileSchema.shape.name.describe(CLAIM_WORDS.name),
  given_name: profileSchema.shape.given_name.describe(CLAIM_WORDS.given_name),
  family_name: profileSchema.shape.family_name.describe(CLAIM_WORDS.family_name),
  middle_name: profileSchema.shape.middle_name.describe(CLAIM_WORDS.middle_name),
  nickname: profileSchema.shape.nickname.describe(CLAIM_WORDS.nickname),
  preferred_username: profileSchema.shape.preferred_username.describe(
    CLAIM_WORDS.preferred_username,
  ),
  profile: profileSchema.shape.profile.describe(CLAIM_WORDS.profile),
  picture: profileSchema.shape.picture.describe(CLAIM_WORDS.picture),
  website: profileSchema.shape.website.describe(CLAIM_WORDS.website),
  gender: profileSchema.shape.gender.describe(CLAIM_WORDS.gender),
  birthdate: profileSchema.shape.birthdate.describe(CLAIM_WORDS.birthdate),
  zoneinfo: profileSchema.shape.zoneinfo.describe(CLAIM_WORDS.zoneinfo),
  locale: profileSchema.shape.locale.describe(CLAIM_WORDS.locale),
  phone_number: profileSchema.shape.phone_number.describe(CLAIM_WORDS.phone_number),
  phone_number_verified: profileSchema.shape.phone_number_verified.describe(
    'Whether the phone number was verified. It turns false when the number changes.',
  ),
  email_verified: profileSchema.shape.email_verified.describe(
    'Whether the email address was verified.',
  ),
  address_formatted: profileSchema.shape.address_formatted.describe(CLAIM_WORDS.address_formatted),
  address_street: profileSchema.shape.address_street.describe(CLAIM_WORDS.address_street),
  address_locality: profileSchema.shape.address_locality.describe(CLAIM_WORDS.address_locality),
  address_region: profileSchema.shape.address_region.describe(CLAIM_WORDS.address_region),
  address_postal_code: profileSchema.shape.address_postal_code.describe(
    CLAIM_WORDS.address_postal_code,
  ),
  address_country: profileSchema.shape.address_country.describe(CLAIM_WORDS.address_country),
  profile_updated_at: profileSchema.shape.profile_updated_at.describe(
    'When the profile last changed, as an ISO 8601 UTC instant. Null if it never has.',
  ),
});
export type MeProfile = z.infer<typeof meProfileSchema>;
