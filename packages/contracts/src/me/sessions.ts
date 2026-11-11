import { z } from 'zod';
import { mePage } from '#/me/shared';

// `current` is the session the token was issued for. `device` is null until a
// session records the device it was opened on.
export const meSessionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  last_active_at: z.string(),
  expires_at: z.string(),
  remembered: z.boolean(),
  current: z.boolean(),
  device: z.null(),
});
export type MeSession = z.infer<typeof meSessionSchema>;

export const meSessionsResponseSchema = mePage(meSessionSchema);
export type MeSessionsResponse = z.infer<typeof meSessionsResponseSchema>;
