import { z } from 'zod';
import { noBidiControls } from '#/bidi';
import { amendProfileRequestSchema } from '#/admin/profile';
import { CLAIM_WORDS } from '#/me/profile';

// What a person writes about themselves: the claims of their profile, and a
// username where the tenant lets one change. The verification flags are proved,
// not stated, and `profile_updated_at` is stamped by the write. `email` is
// typed only so the route can refuse it by name. Any other member is refused,
// not ignored.
export const meAmendProfileRequestSchema = amendProfileRequestSchema
  .omit({ username: true, email_verified: true, phone_number_verified: true })
  .extend({
    name: amendProfileRequestSchema.shape.name.describe(
      `${CLAIM_WORDS.name} Send null to clear it.`,
    ),
    given_name: amendProfileRequestSchema.shape.given_name.describe(
      `${CLAIM_WORDS.given_name} Send null to clear it.`,
    ),
    family_name: amendProfileRequestSchema.shape.family_name.describe(
      `${CLAIM_WORDS.family_name} Send null to clear it.`,
    ),
    middle_name: amendProfileRequestSchema.shape.middle_name.describe(
      `${CLAIM_WORDS.middle_name} Send null to clear it.`,
    ),
    nickname: amendProfileRequestSchema.shape.nickname.describe(
      `${CLAIM_WORDS.nickname} Send null to clear it.`,
    ),
    preferred_username: amendProfileRequestSchema.shape.preferred_username.describe(
      `${CLAIM_WORDS.preferred_username} Send null to clear it.`,
    ),
    profile: amendProfileRequestSchema.shape.profile.describe(
      `${CLAIM_WORDS.profile} Send null to clear it.`,
    ),
    picture: amendProfileRequestSchema.shape.picture.describe(
      `${CLAIM_WORDS.picture} Send null to clear it.`,
    ),
    website: amendProfileRequestSchema.shape.website.describe(
      `${CLAIM_WORDS.website} Send null to clear it.`,
    ),
    gender: amendProfileRequestSchema.shape.gender.describe(
      `${CLAIM_WORDS.gender} Send null to clear it.`,
    ),
    birthdate: amendProfileRequestSchema.shape.birthdate.describe(
      `${CLAIM_WORDS.birthdate} Send null to clear it.`,
    ),
    zoneinfo: amendProfileRequestSchema.shape.zoneinfo.describe(
      `${CLAIM_WORDS.zoneinfo} Send null to clear it.`,
    ),
    locale: amendProfileRequestSchema.shape.locale.describe(
      `${CLAIM_WORDS.locale} Send null to clear it.`,
    ),
    phone_number: amendProfileRequestSchema.shape.phone_number.describe(
      `${CLAIM_WORDS.phone_number} Send null to clear it.`,
    ),
    address_formatted: amendProfileRequestSchema.shape.address_formatted.describe(
      `${CLAIM_WORDS.address_formatted} Send null to clear it.`,
    ),
    address_street: amendProfileRequestSchema.shape.address_street.describe(
      `${CLAIM_WORDS.address_street} Send null to clear it.`,
    ),
    address_locality: amendProfileRequestSchema.shape.address_locality.describe(
      `${CLAIM_WORDS.address_locality} Send null to clear it.`,
    ),
    address_region: amendProfileRequestSchema.shape.address_region.describe(
      `${CLAIM_WORDS.address_region} Send null to clear it.`,
    ),
    address_postal_code: amendProfileRequestSchema.shape.address_postal_code.describe(
      `${CLAIM_WORDS.address_postal_code} Send null to clear it.`,
    ),
    address_country: amendProfileRequestSchema.shape.address_country.describe(
      `${CLAIM_WORDS.address_country} Send null to clear it.`,
    ),
    email: amendProfileRequestSchema.shape.email.describe(
      'A new email address. It is answered with `202` and a mail to that address; the address changes once the person follows the link in it. Send it alone, in a request of its own, with a sign-in recent enough for the change. It cannot be removed, only changed.',
    ),
    username: z
      .string()
      .min(1)
      .regex(/^[^\u0000]*$/)
      .optional()
      .describe(
        'A new username, at least 1 character, unique in the tenant (a taken one is refused with `409`). Refused with `400` where the tenant has not enabled username editing, and needs a sign-in recent enough for the change.',
      ),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { error: 'must name at least one member' });
export type MeAmendProfileRequest = z.infer<typeof meAmendProfileRequestSchema>;

export const MAX_LABEL_LENGTH = 100;

export const meRenameCredentialRequestSchema = z
  .object({
    label: noBidiControls(
      z
        .string()
        .trim()
        .min(1)
        .max(MAX_LABEL_LENGTH)
        .regex(/^[^\u0000]*$/),
    ).describe(
      `The new name, from 1 to ${String(MAX_LABEL_LENGTH)} characters once surrounding whitespace is removed. It may not contain text-direction control characters.`,
    ),
  })
  .strict();
export type MeRenameCredentialRequest = z.infer<typeof meRenameCredentialRequestSchema>;

// Ending one session: the token a person holds may be the session's own, in
// which case it is no longer backed by a session.
export const meSessionEndedSchema = z.object({
  current_session_ended: z
    .boolean()
    .describe(
      'True when the session ended was the one the token was issued for, so the token no longer works.',
    ),
});
export type MeSessionEnded = z.infer<typeof meSessionEndedSchema>;

// Ending the others: one request ends a bounded number, `more` says some remain.
export const meSessionsEndedSchema = z.object({
  ended: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'How many sessions this request ended. The session the token belongs to is not among them.',
    ),
  more: z.boolean().describe('True when other sessions remain; repeat the request to end them.'),
});
export type MeSessionsEnded = z.infer<typeof meSessionsEndedSchema>;

// A change of address is answered 202 and a mail to the new one; the address
// stays what it was until its holder follows the link.
export const meEmailVerificationSentSchema = z.object({
  email_verification_sent: z
    .literal(true)
    .describe(
      'Always true. The response is the same whether or not the address is registered or can be mailed, so it does not reveal which addresses exist.',
    ),
});
export type MeEmailVerificationSent = z.infer<typeof meEmailVerificationSentSchema>;
