import { z } from 'zod';
import { mePage } from '#/me/shared';

// `client_id` is the OAuth `client_id` the application knows itself by.
export const meConsentSchema = z.object({
  client_id: z.string(),
  scope_names: z.array(z.string()),
  granted_at: z.string(),
});
export type MeConsent = z.infer<typeof meConsentSchema>;

export const meConsentsResponseSchema = mePage(meConsentSchema);
export type MeConsentsResponse = z.infer<typeof meConsentsResponseSchema>;
