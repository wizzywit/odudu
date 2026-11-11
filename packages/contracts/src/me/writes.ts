import { z } from 'zod';
import { noBidiControls } from '#/bidi';
import { amendProfileRequestSchema } from '#/admin/profile';

// What a person writes about themselves: the claims of their profile, and none
// of the members that are not theirs to set. The verification flags are proved,
// not stated, `email` and `username` are identity, and `profile_updated_at` is
// stamped by the write. Any other member is refused, not ignored.
export const meAmendProfileRequestSchema = amendProfileRequestSchema
  .omit({ email: true, username: true, email_verified: true, phone_number_verified: true })
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
    ),
  })
  .strict();
export type MeRenameCredentialRequest = z.infer<typeof meRenameCredentialRequestSchema>;

// Ending one session: the token a person holds may be the session's own, in
// which case it is no longer backed by a session.
export const meSessionEndedSchema = z.object({ current_session_ended: z.boolean() });
export type MeSessionEnded = z.infer<typeof meSessionEndedSchema>;

// Ending the others: one request ends a bounded number, `more` says some remain.
export const meSessionsEndedSchema = z.object({
  ended: z.number().int().nonnegative(),
  more: z.boolean(),
});
export type MeSessionsEnded = z.infer<typeof meSessionsEndedSchema>;
