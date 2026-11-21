import { z } from 'zod';
import { mePage } from '#/me/shared';

// `current` is the session the token was issued for. `device` is an opaque id
// shared by the sessions opened on one browser, null for a session opened
// before the id was recorded.
export const meSessionSchema = z.object({
  id: z.string().describe('The session’s identifier, for ending it.'),
  created_at: z.string().describe('When the person signed in, as an ISO 8601 UTC instant.'),
  last_active_at: z
    .string()
    .describe('When the session was last used, as an ISO 8601 UTC instant.'),
  expires_at: z
    .string()
    .describe(
      'When the session ends if it is not used again, as an ISO 8601 UTC instant, according to the tenant’s session lifespans.',
    ),
  remembered: z.boolean().describe('Whether the person chose to stay signed in on that device.'),
  current: z.boolean().describe('Whether this is the session the token was issued for.'),
  device: z
    .string()
    .nullable()
    .describe(
      'An opaque identifier shared by the sessions opened on one browser, to group them. Null for a session opened before it was recorded.',
    ),
});
export type MeSession = z.infer<typeof meSessionSchema>;

export const meSessionsResponseSchema = mePage(meSessionSchema, 'sessions');
export type MeSessionsResponse = z.infer<typeof meSessionsResponseSchema>;
