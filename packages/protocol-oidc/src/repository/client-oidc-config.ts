import { type RealmScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { clientOidcConfig, type ClientOidcConfig } from '#/schema/client-oidc-config';

export type { ClientOidcConfig } from '#/schema/client-oidc-config';

function toRecord(row: typeof clientOidcConfig.$inferSelect): ClientOidcConfig {
  return {
    clientId: row.clientId,
    realmId: row.realmId,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes,
    tokenEndpointAuthMethod:
      row.tokenEndpointAuthMethod as ClientOidcConfig['tokenEndpointAuthMethod'],
    audiences: row.audiences,
    accessTokenTtlSeconds: row.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: row.refreshTokenTtlSeconds,
    clientCredentialsScopes: row.clientCredentialsScopes,
  };
}

// `clientCredentialsScopes` defaults to none: every existing caller that
// predates the client_credentials grant creates a config without deciding
// on one, and an empty allowlist is the safe default for a client no one
// has yet configured for it.
export type NewClientOidcConfig = Omit<ClientOidcConfig, 'clientCredentialsScopes'> & {
  clientCredentialsScopes?: string[];
};

export function clientOidcConfigRepository(tx: RealmScopedDatabase) {
  return {
    // Keyed by the client's internal id (clients.id), not the OAuth
    // client_id string — callers look up ClientRecord first via
    // clientRepository(tx).byClientId(oauthClientId) and pass its `.id` here.
    async byClientId(clientId: string): Promise<ClientOidcConfig | null> {
      const rows = await tx
        .select()
        .from(clientOidcConfig)
        .where(eq(clientOidcConfig.clientId, clientId));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async create(input: NewClientOidcConfig): Promise<ClientOidcConfig> {
      const rows = await tx
        .insert(clientOidcConfig)
        .values({
          clientId: input.clientId,
          realmId: input.realmId,
          redirectUris: input.redirectUris,
          grantTypes: input.grantTypes,
          tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
          audiences: input.audiences,
          accessTokenTtlSeconds: input.accessTokenTtlSeconds,
          refreshTokenTtlSeconds: input.refreshTokenTtlSeconds,
          clientCredentialsScopes: input.clientCredentialsScopes ?? [],
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into client_oidc_config returned no row');
      }
      return toRecord(row);
    },
  };
}
