import { boolean, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { type TokenEndpointAuthMethod } from '@odudu/contracts';
import { clients } from '@odudu/domain-realm';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// `clientId` is the client's own internal id (clients.id), not the OAuth
// client_id string — this table is a one-to-one extension of `clients`, so
// its primary key doubles as the foreign key.
export const clientOidcConfig = pgTable('client_oidc_config', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  realmId: uuid('realm_id').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull(),
  audiences: text('audiences').array().notNull().default([]),
  accessTokenTtlSeconds: integer('access_token_ttl_seconds').notNull().default(300),
  refreshTokenTtlSeconds: integer('refresh_token_ttl_seconds').notNull().default(1_209_600),
  // The ceiling on what client_credentials may request — resource-server
  // scopes (e.g. `reports:read`), not the OIDC vocabulary the realm's
  // client_scopes carry, since this grant has no consent screen and no
  // authorization request to intersect against.
  clientCredentialsScopes: text('client_credentials_scopes').array().notNull().default([]),
  webOrigins: text('web_origins').array().notNull().default([]),
  // RP-Initiated Logout §3's exact-match list — see migration
  // 0030_client_post_logout_redirect_uris.sql for why it lives here rather
  // than with the rest of the client metadata.
  postLogoutRedirectUris: text('post_logout_redirect_uris').array().notNull().default([]),
  // By value or by reference, never both (client_oidc_config_one_key_source,
  // RFC 7591 §2) — an untyped boundary; Task 10 narrows it with Zod at the
  // point of use.
  jwks: jsonb('jwks'),
  jwksUri: text('jwks_uri'),
  frontchannelLogoutUri: text('frontchannel_logout_uri'),
  backchannelLogoutUri: text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required')
    .notNull()
    .default(false),
  // Whether this client's authorization requests skip the consent screen.
  // Defaults false so an existing seeded client's behaviour is unchanged.
  consentRequired: boolean('consent_required').notNull().default(false),
  userinfoSignedResponseAlg: text('userinfo_signed_response_alg'),
  userinfoEncryptedResponseAlg: text('userinfo_encrypted_response_alg'),
  // Requires userinfoEncryptedResponseAlg
  // (client_oidc_config_userinfo_enc_needs_alg, OIDC Core §5.3.2).
  userinfoEncryptedResponseEnc: text('userinfo_encrypted_response_enc'),
}).enableRLS();

// Redirect URIs and grant types are OAuth vocabulary; they live here rather
// than on domain-realm's protocol-agnostic ClientRecord, so that a second
// protocol can add its own configuration table without touching the domain.
export interface ClientOidcConfig {
  clientId: string;
  realmId: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  audiences: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  clientCredentialsScopes: string[];
  webOrigins: string[];
  postLogoutRedirectUris: string[];
  jwks: unknown;
  jwksUri: string | null;
  frontchannelLogoutUri: string | null;
  backchannelLogoutUri: string | null;
  backchannelLogoutSessionRequired: boolean;
  consentRequired: boolean;
  userinfoSignedResponseAlg: string | null;
  userinfoEncryptedResponseAlg: string | null;
  userinfoEncryptedResponseEnc: string | null;
}
