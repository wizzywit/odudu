import { z } from 'zod';

// PostgreSQL's `text` cannot hold a NUL byte (see `searchPrefixSchema`,
// #/admin/shared.ts): every claim column is `text`, so the same guard
// applies here — otherwise a NUL in the body reaches the driver as a
// 500 instead of a 400 ajv refuses it with.
const claim = z
  .string()
  .regex(/^[^\u0000]*$/)
  .nullable();

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
