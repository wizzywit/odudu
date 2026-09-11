import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
}).enableRLS();

// Redirect URIs and grant types are OAuth vocabulary; they live here rather
// than on domain-realm's protocol-agnostic ClientRecord (Task 8).
export interface ClientOidcConfig {
  clientId: string;
  realmId: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  audiences: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}
