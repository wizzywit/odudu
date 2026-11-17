import { z } from 'zod';
import { profileSchema } from '#/admin/profile';

// The profile claims as the admin API states them, with who the person is.
export const meProfileSchema = profileSchema.extend({
  sub: z.string(),
  username: z.string(),
  email: z.string().nullable(),
});
export type MeProfile = z.infer<typeof meProfileSchema>;
