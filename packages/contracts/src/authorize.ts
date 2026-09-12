import { z } from 'zod';

// The /authorize query schema (RFC 6749 §4.1.1, PKCE mandatory per this
// phase's design; OIDC Core §3.1.2.1 request parameters added for
// completeness). Structural shape only: the /authorize handler owns the
// ordering rules — which failures render an error page and which redirect to
// the client — because a schema cannot express that a check's position in
// the sequence is what makes it safe (a structural check run first would
// collapse render-vs-redirect for, e.g., a missing redirect_uri). This
// schema is not wired into that route for that reason; it exists for other
// consumers of the /authorize contract, so keep it complete rather than
// deleting it as unused.
export const authorizeQuerySchema = z.object({
  response_type: z.string(),
  client_id: z.string(),
  redirect_uri: z.string(),
  scope: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string(),
  code_challenge_method: z.string(),
  nonce: z.string().optional(),
  display: z.string().optional(),
  prompt: z.string().optional(),
  max_age: z.string().optional(),
  ui_locales: z.string().optional(),
  login_hint: z.string().optional(),
  id_token_hint: z.string().optional(),
  acr_values: z.string().optional(),
});

export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;
