import { z } from 'zod';
import { mePage } from '#/me/shared';

// `current` is the session the token was issued for. `device` is an opaque id
// shared by the sessions opened on one browser, null for a session opened
// before the id was recorded.
export const meSessionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  last_active_at: z.string(),
  expires_at: z.string(),
  remembered: z.boolean(),
  current: z.boolean(),
  device: z.string().nullable(),
});
export type MeSession = z.infer<typeof meSessionSchema>;

export const meSessionsResponseSchema = mePage(meSessionSchema);
export type MeSessionsResponse = z.infer<typeof meSessionsResponseSchema>;
