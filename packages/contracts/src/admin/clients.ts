import { z } from 'zod';
import { createdAtSchema, idSchema } from '#/admin/shared';

export const clientTypeSchema = z.enum(['public', 'confidential']);
export const registrationOriginSchema = z.enum(['seeded', 'anonymous', 'token']);

export const clientSchema = z.object({
  id: idSchema,
  client_id: z.string(),
  name: z.string(),
  type: clientTypeSchema,
  enabled: z.boolean(),
  full_scope_allowed: z.boolean(),
  registration_origin: registrationOriginSchema,
  created_at: createdAtSchema,
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  audiences: z.array(z.string()),
  access_token_ttl_seconds: z.number().int(),
  refresh_token_ttl_seconds: z.number().int(),
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
// registration where the server assigns it — everything else is the same
// client metadata `parseClientMetadata` (@odudu/protocol-oidc) narrows, so
// ajv only checks the body is a JSON object naming one.
export const createClientRequestSchema = z
  .object({ client_id: z.string().min(1) })
  .catchall(z.unknown());
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;

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

export const rotateClientSecretResponseSchema = clientSchema.extend({
  client_secret: z.string(),
});
export type RotateClientSecretResponse = z.infer<typeof rotateClientSecretResponseSchema>;
