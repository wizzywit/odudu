import { type RealmScopedDatabase } from '@odudu/db';
import { clients } from '@odudu/domain-realm';
import { eq } from 'drizzle-orm';
import { clientOidcConfig, type ClientOidcConfig } from '#/schema/client-oidc-config';
import { expandWebOrigins } from '#/service/web-origin';

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
    webOrigins: row.webOrigins,
  };
}

// `clientCredentialsScopes` and `webOrigins` default to none: every existing
// caller that predates them creates a config without deciding on either, and
// an empty allowlist is the safe default for a client no one has yet
// configured for it.
export type NewClientOidcConfig = Omit<
  ClientOidcConfig,
  'clientCredentialsScopes' | 'webOrigins'
> & {
  clientCredentialsScopes?: string[];
  webOrigins?: string[];
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
          webOrigins: input.webOrigins ?? [],
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into client_oidc_config returned no row');
      }
      return toRecord(row);
    },

    // A CORS preflight carries no client identity, so the only allowlist
    // available at that moment is the realm's union. The per-client list is
    // enforced on the real request, where the client is known. Joined to
    // `clients` and filtered to `enabled`: a client disabled because its
    // origin was compromised must not keep that origin working here.
    async webOriginsForRealm(): Promise<ReadonlySet<string>> {
      const rows = await tx
        .select({
          webOrigins: clientOidcConfig.webOrigins,
          redirectUris: clientOidcConfig.redirectUris,
        })
        .from(clientOidcConfig)
        .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
        .where(eq(clients.enabled, true));
      const union = new Set<string>();
      for (const row of rows) {
        for (const origin of expandWebOrigins(row.webOrigins, row.redirectUris)) union.add(origin);
      }
      return union;
    },
  };
}
