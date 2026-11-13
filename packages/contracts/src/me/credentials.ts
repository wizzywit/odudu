import { z } from 'zod';
import { mePage } from '#/me/shared';

// What a person may be shown of a way to sign in: never the material that
// makes it work. A recovery code is counted rather than listed, and a retired
// password is not shown at all.
export const meCredentialTypeSchema = z.enum(['password', 'totp', 'webauthn']);

export const meCredentialSchema = z.object({
  id: z.string(),
  type: meCredentialTypeSchema,
  label: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});
export type MeCredential = z.infer<typeof meCredentialSchema>;

export const meCredentialsResponseSchema = mePage(meCredentialSchema).extend({
  recovery_codes_left: z.number().int().nonnegative(),
  // Whether the person holds a recovery set that has run below the tenant's
  // threshold; false for a person with no set.
  recovery_codes_low: z.boolean(),
});
export type MeCredentialsResponse = z.infer<typeof meCredentialsResponseSchema>;
