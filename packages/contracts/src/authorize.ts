import { z } from 'zod';

// The /authorize query schema (RFC 6749 §4.1.1, PKCE mandatory per this
// phase's design). Structural shape only — Task 12 owns the ordering rules
// (which failures render vs. redirect) that this schema cannot express.
export const authorizeQuerySchema = z.object({
  response_type: z.string(),
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string(),
  code_challenge_method: z.string(),
});

export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;
