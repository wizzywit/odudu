import { z } from 'zod';
import { mePage } from '#/me/shared';

// What a person may be shown of a way to sign in: never the material that
// makes it work. A recovery code is counted rather than listed, and a retired
// password is not shown at all.
export const meCredentialTypeSchema = z
  .enum(['password', 'totp', 'webauthn'])
  .describe(
    '`password`, `totp` for an authenticator app, or `webauthn` for a passkey or security key.',
  );

export const meCredentialSchema = z.object({
  id: z.string().describe('The credential’s identifier, for renaming or removing it.'),
  type: meCredentialTypeSchema,
  label: z
    .string()
    .nullable()
    .describe('The name the person gave it, such as “Work laptop”. Null when it has none.'),
  created_at: z.string().describe('When it was added, as an ISO 8601 UTC instant.'),
  last_used_at: z
    .string()
    .nullable()
    .describe('When it last signed the person in, as an ISO 8601 UTC instant. Null if never.'),
});
export type MeCredential = z.infer<typeof meCredentialSchema>;

export const meCredentialsResponseSchema = mePage(meCredentialSchema, 'ways to sign in').extend({
  recovery_codes_left: z
    .number()
    .int()
    .nonnegative()
    .describe('How many recovery codes the person still holds unspent; 0 for a person with none.'),
  recovery_codes_low: z
    .boolean()
    .describe(
      'Whether the person holds a recovery set that has run below the tenant’s warning threshold. False for a person with no set, and always false where the tenant turned the warning off.',
    ),
});
export type MeCredentialsResponse = z.infer<typeof meCredentialsResponseSchema>;
