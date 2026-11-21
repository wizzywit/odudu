import { z } from 'zod';
import { mePage } from '#/me/shared';

// `client_id` is the OAuth `client_id` the application knows itself by.
export const meConsentSchema = z.object({
  client_id: z
    .string()
    .describe('The `client_id` of the application the person allowed; it identifies the consent.'),
  scope_names: z.array(z.string()).describe('The scopes the person allowed that application.'),
  granted_at: z.string().describe('When the consent was given, as an ISO 8601 UTC instant.'),
});
export type MeConsent = z.infer<typeof meConsentSchema>;

export const meConsentsResponseSchema = mePage(meConsentSchema, 'consents');
export type MeConsentsResponse = z.infer<typeof meConsentsResponseSchema>;
