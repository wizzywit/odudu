import { z } from 'zod';
import { clientScopeAssignmentViewSchema } from '#/admin/scopes';
import {
  createdAtSchema,
  cursorQuerySchema,
  enabledFilterSchema,
  idSchema,
  searchPrefixSchema,
} from '#/admin/shared';

export const clientTypeSchema = z.enum(['public', 'confidential']);
export const registrationOriginSchema = z.enum(['seeded', 'anonymous', 'token', 'operator']);

export const clientSchema = z.object({
  id: idSchema,
  client_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: clientTypeSchema,
  enabled: z.boolean(),
  full_scope_allowed: z.boolean(),
  registration_origin: registrationOriginSchema,
  created_at: createdAtSchema,
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  audiences: z.array(z.string()),
  // Null takes the tenant's lifetime of the same name.
  access_token_ttl_seconds: z.number().int().nullable(),
  id_token_ttl_seconds: z.number().int().nullable(),
  refresh_token_ttl_seconds: z.number().int().nullable(),
  client_credentials_scopes: z.array(z.string()),
  web_origins: z.array(z.string()),
  post_logout_redirect_uris: z.array(z.string()),
  jwks: z.unknown().nullable(),
  jwks_uri: z.string().nullable(),
  frontchannel_logout_uri: z.string().nullable(),
  backchannel_logout_uri: z.string().nullable(),
  frontchannel_logout_session_required: z.boolean(),
  backchannel_logout_session_required: z.boolean(),
  consent_required: z.boolean(),
  token_exchange_impersonation_allowed: z.boolean(),
  userinfo_signed_response_alg: z.string().nullable(),
  userinfo_encrypted_response_alg: z.string().nullable(),
  userinfo_encrypted_response_enc: z.string().nullable(),
  tls_client_auth_subject_dn: z.string().nullable(),
  client_uri: z.string().nullable(),
  policy_uri: z.string().nullable(),
  tos_uri: z.string().nullable(),
  id_token_signed_response_alg: z.string().nullable(),
  default_max_age: z.number().int().nullable(),
  require_auth_time: z.boolean(),
  // When the secret a rotation replaced stops authenticating; null once it
  // has, or when no rotation kept one. Never the secret itself.
  previous_secret_expires_at: z.string().nullable(),
  builtin_admin: z.boolean(),
  service_subject_id: z.uuid().nullable(),
  scopes: z.array(clientScopeAssignmentViewSchema),
});
export type Client = z.infer<typeof clientSchema>;

// A confidential client's generated secret, carried only in the creation
// response — never in a read or a list, and never stored except as its
// hash (`clients.secret_hash`).
export const createClientResponseSchema = clientSchema.extend({
  client_secret: z.string().optional(),
});
export type CreateClientResponse = z.infer<typeof createClientResponseSchema>;

// `client_id` is chosen by the operator, unlike RFC 7591 dynamic
// registration where the server assigns it. The rest is checked by the
// usecase, not this shape, the way `amendClientRequestSchema` leaves it —
// so ajv only checks the body is a JSON object naming a `client_id`.
export const createClientRequestSchema = z
  .object({ client_id: z.string().min(1) })
  .catchall(z.unknown())
  .describe(
    'RFC 7591 client metadata, plus any field PATCH /clients/{id} amends ' +
      '(audiences, web_origins, token lifetimes, …). Any other field is ' +
      'refused with 400 naming it, never ignored.',
  );
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

const clientFilters = {
  client_id: searchPrefixSchema.optional(),
  name: searchPrefixSchema.optional(),
  type: clientTypeSchema.optional(),
  enabled: enabledFilterSchema.optional(),
};
// Addressed to the second field, the one a caller adds to an existing search.
const oneClientSearchRule = {
  message: 'search one field at a time: client_id or name, not both',
  path: ['name'],
};
const oneClientSearch = [
  (query: { client_id?: string | undefined; name?: string | undefined }) =>
    query.client_id === undefined || query.name === undefined,
  oneClientSearchRule,
] as const;

export const listClientsQuerySchema = cursorQuerySchema
  .extend(clientFilters)
  .strict()
  .refine(...oneClientSearch);
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export const countClientsQuerySchema = z
  .object(clientFilters)
  .strict()
  .refine(...oneClientSearch);
export type CountClientsQuery = z.infer<typeof countClientsQuerySchema>;

export const listClientsResponseSchema = z.object({
  items: z.array(clientSchema),
  next: z.string().optional(),
});
export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;

// A caller may name any field it believes is a client field, amendable or
// not — the usecase, not this shape, is what tells the two apart and gives
// the excluded one its reason (client-patch.ts's `refusalFor`).
export const amendClientRequestSchema = z.record(z.string(), z.unknown());
export type AmendClientRequest = z.infer<typeof amendClientRequestSchema>;

// How long the replaced secret keeps authenticating beside the new one.
// Zero, the default, ends it at once — the right answer to a leak. A week
// covers a weekly deployment picking up the new secret; a longer window is
// a second standing credential nobody is tracking.
export const CLIENT_SECRET_GRACE_MAX_SECONDS = 604_800;
export const rotateClientSecretQuerySchema = z
  .object({
    grace_seconds: z.coerce.number().int().min(0).max(CLIENT_SECRET_GRACE_MAX_SECONDS).optional(),
  })
  .strict();
export type RotateClientSecretQuery = z.infer<typeof rotateClientSecretQuerySchema>;

export const rotateClientSecretResponseSchema = clientSchema.extend({
  client_secret: z.string(),
});
export type RotateClientSecretResponse = z.infer<typeof rotateClientSecretResponseSchema>;

export const LOGOUT_DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const;
export const logoutDeliveryStatusSchema = z.enum(LOGOUT_DELIVERY_STATUSES);

export const listLogoutDeliveriesQuerySchema = cursorQuerySchema
  .extend({ status: logoutDeliveryStatusSchema.optional() })
  .strict();
export type ListLogoutDeliveriesQuery = z.infer<typeof listLogoutDeliveriesQuerySchema>;

// One Back-Channel Logout Token queued for the client: never the token.
export const logoutDeliverySchema = z.object({
  id: idSchema,
  session_id: idSchema,
  endpoint: z.string(),
  status: logoutDeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  created_at: createdAtSchema,
  next_attempt_at: z.string(),
  delivered_at: z.string().nullable(),
});
export type LogoutDelivery = z.infer<typeof logoutDeliverySchema>;

export const listLogoutDeliveriesResponseSchema = z.object({
  items: z.array(logoutDeliverySchema),
  next: z.string().optional(),
});
export type ListLogoutDeliveriesResponse = z.infer<typeof listLogoutDeliveriesResponseSchema>;

// What a relying party is configured with, from the client and the issuer
// it is registered under. Never the secret, which is shown once, at creation
// or rotation.
export const clientInstallationSchema = z.object({
  issuer: z.string(),
  discovery_url: z.string(),
  client_id: z.string(),
  client_type: clientTypeSchema,
  token_endpoint_auth_method: z.string(),
  redirect_uris: z.array(z.string()),
  post_logout_redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  default_scope: z.string(),
});
export type ClientInstallation = z.infer<typeof clientInstallationSchema>;

// `scope` as a request carries it, space-separated; absent, the client's
// default scopes. `subject` is the subject a token would be issued to. The
// bound is on what a caller can make the server split and look up.
export const EVALUATE_SCOPE_MAX = 2048;
export const evaluateClaimsQuerySchema = z
  .object({ subject: z.uuid(), scope: z.string().max(EVALUATE_SCOPE_MAX).optional() })
  .strict();
export type EvaluateClaimsQuery = z.infer<typeof evaluateClaimsQuerySchema>;

// The claims each artefact would carry, mapped as issuance maps them, with
// none of the envelope a signer adds. `id_token` is null without `openid`.
export const evaluateClaimsResponseSchema = z.object({
  scope: z.string(),
  id_token: z.record(z.string(), z.unknown()).nullable(),
  access_token: z.record(z.string(), z.unknown()),
  userinfo: z.record(z.string(), z.unknown()),
});
export type EvaluateClaimsResponse = z.infer<typeof evaluateClaimsResponseSchema>;
