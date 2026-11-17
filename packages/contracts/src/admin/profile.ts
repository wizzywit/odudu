import { z } from 'zod';
import { noBidiControls } from '#/bidi';

// PostgreSQL's `text` cannot hold a NUL byte (see `searchPrefixSchema`,
// #/admin/shared.ts): every claim column is `text`, so the same guard
// applies here — otherwise a NUL in the body reaches the driver as a
// 500 instead of a 400 ajv refuses it with.
const claim = z
  .string()
  .regex(/^[^\u0000]*$/)
  .nullable();

// A claim that names a person, as an imported document carries it: a creation,
// so it holds no bidirectional control, which would reorder the text around it
// wherever it is shown. The PATCH body takes the plain claim instead, because
// an amendment is judged against the stored value (usecase/profile.ts).
const nameClaim = noBidiControls(z.string().regex(/^[^\u0000]*$/)).nullable();

export const nameClaims = {
  name: nameClaim,
  given_name: nameClaim,
  family_name: nameClaim,
  middle_name: nameClaim,
  nickname: nameClaim,
  preferred_username: nameClaim,
};

// Every OIDC Core §5.1 claim column on `users`, in the snake_case a wire
// shape carries — `username_search`/`email_search` (packages/db/drizzle/
// 0073_list_indexes_subjects.sql) are derived search keys, never a claim,
// and never appear here. `profile_updated_at` is the OIDC `updated_at`
// claim: stamped by `updateProfile`, never supplied by a caller.
export const profileSchema = z.object({
  name: claim,
  given_name: claim,
  family_name: claim,
  middle_name: claim,
  nickname: claim,
  preferred_username: claim,
  profile: claim,
  picture: claim,
  website: claim,
  gender: claim,
  birthdate: claim,
  zoneinfo: claim,
  locale: claim,
  phone_number: claim,
  phone_number_verified: z.boolean(),
  email_verified: z.boolean(),
  address_formatted: claim,
  address_street: claim,
  address_locality: claim,
  address_region: claim,
  address_postal_code: claim,
  address_country: claim,
  profile_updated_at: z.string().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

// Every member a caller may `PATCH`: every claim column, and the two
// verification flags — both writable here, since only an operator with
// `manage-users` reaches this door at all. `email` and `username` are
// deliberately typed rather than left as unknown properties: recognising
// them lets `amendProfile` (packages/protocol-admin/src/usecase/profile.ts)
// refuse each by name, pointing at the route that actually owns it,
// instead of ajv's generic "additional property" message.
export const amendProfileRequestSchema = z.object({
  name: claim.optional(),
  given_name: claim.optional(),
  family_name: claim.optional(),
  middle_name: claim.optional(),
  nickname: claim.optional(),
  preferred_username: claim.optional(),
  profile: claim.optional(),
  picture: claim.optional(),
  website: claim.optional(),
  gender: claim.optional(),
  birthdate: claim.optional(),
  zoneinfo: claim.optional(),
  locale: claim.optional(),
  phone_number: claim.optional(),
  phone_number_verified: z.boolean().optional(),
  email_verified: z.boolean().optional(),
  address_formatted: claim.optional(),
  address_street: claim.optional(),
  address_locality: claim.optional(),
  address_region: claim.optional(),
  address_postal_code: claim.optional(),
  address_country: claim.optional(),
  email: z.unknown().optional(),
  username: z.unknown().optional(),
});
export type AmendProfileRequest = z.infer<typeof amendProfileRequestSchema>;

// The claims a person writes about themselves, by wire name: every claim of the
// profile but the verification flags and the stamp, which are proved or set by
// the write. The order is the one a form lays them out in.
export const PROFILE_CLAIM_NAMES = [
  'name',
  'given_name',
  'family_name',
  'middle_name',
  'nickname',
  'preferred_username',
  'profile',
  'picture',
  'website',
  'gender',
  'birthdate',
  'zoneinfo',
  'locale',
  'phone_number',
  'address_formatted',
  'address_street',
  'address_locality',
  'address_region',
  'address_postal_code',
  'address_country',
] as const;
export type ProfileClaimName = (typeof PROFILE_CLAIM_NAMES)[number];

// What the `update-profile` action asks a tenant's people for until the tenant
// chooses.
export const DEFAULT_REQUIRED_PROFILE_FIELDS: readonly ProfileClaimName[] = [
  'given_name',
  'family_name',
];

// A text's length in characters, as the database counts them, not in UTF-16
// units: an astral character is one.
export function characterCount(text: string): number {
  return Array.from(text).length;
}
