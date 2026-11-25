import { z } from 'zod';
import { noBidiControls } from '#/bidi';

export const MAX_DELEGATIONS = 20;
export const MIN_DELEGATION_EXPIRES_IN = 60;
export const MAX_DELEGATION_EXPIRES_IN = 7_776_000;
export const MAX_DELEGATION_SCOPE_LENGTH = 1000;
export const MAX_CLIENT_ID_LENGTH = 255;

// A scope is an RFC 6749 section 3.3 token: printable ASCII with no space,
// quotation mark or backslash.
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

const scopeCeiling = noBidiControls(z.string().max(MAX_DELEGATION_SCOPE_LENGTH)).transform(
  (value, ctx) => {
    const tokens = [...new Set(value.split(' ').filter((token) => token !== ''))];
    if (tokens.length === 0 || !tokens.every((token) => SCOPE_TOKEN.test(token))) {
      ctx.addIssue({ code: 'custom', message: 'must name at least one scope' });
      return z.NEVER;
    }
    return tokens.join(' ');
  },
);

export const meCreateDelegationRequestSchema = z
  .object({
    client_id: z
      .string()
      .min(1)
      .max(MAX_CLIENT_ID_LENGTH)
      .describe('The `client_id` of the application the person signs in with, as listed.'),
    actor_client_id: z
      .string()
      .min(1)
      .max(MAX_CLIENT_ID_LENGTH)
      .describe(
        'The `client_id` of the agent client allowed to act for the person. It must be an agent client of the tenant.',
      ),
    scope_ceiling: scopeCeiling.describe(
      `The scopes the agent may use for the person, space-separated, at most ${String(MAX_DELEGATION_SCOPE_LENGTH)} characters. Repeated scopes are kept once. An agent never gets more than the person's own token carries, whatever this names.`,
    ),
    expires_in: z
      .number()
      .int()
      .min(MIN_DELEGATION_EXPIRES_IN)
      .max(MAX_DELEGATION_EXPIRES_IN)
      .describe(
        `How long the delegation lasts, in whole seconds, from ${String(MIN_DELEGATION_EXPIRES_IN)} to ${String(MAX_DELEGATION_EXPIRES_IN)} (90 days).`,
      ),
  })
  .strict();
export type MeCreateDelegationRequest = z.infer<typeof meCreateDelegationRequestSchema>;

export const meDelegationSchema = z.object({
  id: z.string().describe('The delegation’s identifier, for revoking it.'),
  client_id: z.string().describe('The `client_id` of the application the person signs in with.'),
  actor_client_id: z.string().describe('The `client_id` of the agent client allowed to act.'),
  scope_ceiling: z.string().describe('The scopes the agent may use, space-separated.'),
  expires_at: z.string().describe('When the delegation ends, as an ISO 8601 UTC instant.'),
  created_at: z.string().describe('When it was made, as an ISO 8601 UTC instant.'),
});
export type MeDelegation = z.infer<typeof meDelegationSchema>;

export const meDelegationsResponseSchema = z.object({
  items: z
    .array(meDelegationSchema)
    .describe(
      `The person’s live delegations, newest first: at most ${String(MAX_DELEGATIONS)}, so the answer is never paged. Revoked and expired ones are not listed.`,
    ),
});
export type MeDelegationsResponse = z.infer<typeof meDelegationsResponseSchema>;
