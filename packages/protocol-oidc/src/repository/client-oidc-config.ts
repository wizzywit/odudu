import { type TenantScopedDatabase } from '@odudu/db';
import { asc, eq, gt, sql } from 'drizzle-orm';
import { clientOidcConfig, type ClientOidcConfig } from '#/schema/client-oidc-config';
import { clientOrigins } from '#/schema/client-origins';
import { expandWebOrigins } from '#/service/web-origin';

export type { ClientOidcConfig } from '#/schema/client-oidc-config';

function toRecord(row: typeof clientOidcConfig.$inferSelect): ClientOidcConfig {
  return {
    clientId: row.clientId,
    tenantId: row.tenantId,
    redirectUris: row.redirectUris,
    grantTypes: row.grantTypes,
    tokenEndpointAuthMethod:
      row.tokenEndpointAuthMethod as ClientOidcConfig['tokenEndpointAuthMethod'],
    audiences: row.audiences,
    accessTokenTtlSeconds: row.accessTokenTtlSeconds,
    idTokenTtlSeconds: row.idTokenTtlSeconds,
    refreshTokenTtlSeconds: row.refreshTokenTtlSeconds,
    clientCredentialsScopes: row.clientCredentialsScopes,
    webOrigins: row.webOrigins,
    postLogoutRedirectUris: row.postLogoutRedirectUris,
    jwks: row.jwks,
    jwksUri: row.jwksUri,
    frontchannelLogoutUri: row.frontchannelLogoutUri,
    backchannelLogoutUri: row.backchannelLogoutUri,
    backchannelLogoutSessionRequired: row.backchannelLogoutSessionRequired,
    frontchannelLogoutSessionRequired: row.frontchannelLogoutSessionRequired,
    consentRequired: row.consentRequired,
    tokenExchangeImpersonationAllowed: row.tokenExchangeImpersonationAllowed,
    userinfoSignedResponseAlg: row.userinfoSignedResponseAlg,
    userinfoEncryptedResponseAlg: row.userinfoEncryptedResponseAlg,
    userinfoEncryptedResponseEnc: row.userinfoEncryptedResponseEnc,
    tlsClientAuthSubjectDn: row.tlsClientAuthSubjectDn,
    clientUri: row.clientUri,
    policyUri: row.policyUri,
    tosUri: row.tosUri,
    // client_oidc_config_id_token_alg_check bounds the column.
    idTokenSignedResponseAlg:
      row.idTokenSignedResponseAlg as ClientOidcConfig['idTokenSignedResponseAlg'],
    defaultMaxAge: row.defaultMaxAge,
    requireAuthTime: row.requireAuthTime,
  };
}

// `clientCredentialsScopes`, `webOrigins` and `postLogoutRedirectUris`
// default to none: every existing caller that predates them creates a
// config without deciding on any of the three, and an empty allowlist is
// the safe default for a client no one has yet configured for it. The
// client-metadata fields default the same way their columns do, so every
// caller that predates them keeps behaving as if they did not exist.
export type NewClientOidcConfig = Omit<
  ClientOidcConfig,
  | 'idTokenTtlSeconds'
  | 'clientCredentialsScopes'
  | 'webOrigins'
  | 'postLogoutRedirectUris'
  | 'jwks'
  | 'jwksUri'
  | 'frontchannelLogoutUri'
  | 'backchannelLogoutUri'
  | 'backchannelLogoutSessionRequired'
  | 'frontchannelLogoutSessionRequired'
  | 'consentRequired'
  | 'tokenExchangeImpersonationAllowed'
  | 'userinfoSignedResponseAlg'
  | 'userinfoEncryptedResponseAlg'
  | 'userinfoEncryptedResponseEnc'
  | 'tlsClientAuthSubjectDn'
  | 'clientUri'
  | 'policyUri'
  | 'tosUri'
  | 'idTokenSignedResponseAlg'
  | 'defaultMaxAge'
  | 'requireAuthTime'
> & {
  idTokenTtlSeconds?: number | null;
  clientCredentialsScopes?: string[];
  webOrigins?: string[];
  postLogoutRedirectUris?: string[];
  jwks?: unknown;
  jwksUri?: string | null;
  frontchannelLogoutUri?: string | null;
  backchannelLogoutUri?: string | null;
  backchannelLogoutSessionRequired?: boolean;
  frontchannelLogoutSessionRequired?: boolean;
  consentRequired?: boolean;
  tokenExchangeImpersonationAllowed?: boolean;
  userinfoSignedResponseAlg?: string | null;
  userinfoEncryptedResponseAlg?: string | null;
  userinfoEncryptedResponseEnc?: string | null;
  tlsClientAuthSubjectDn?: string | null;
  clientUri?: string | null;
  policyUri?: string | null;
  tosUri?: string | null;
  idTokenSignedResponseAlg?: ClientOidcConfig['idTokenSignedResponseAlg'];
  defaultMaxAge?: number | null;
  requireAuthTime?: boolean;
};

// The origins a client allows, rewritten from its lists as the server compares
// origins (`expandWebOrigins`), so the preflight's probe and the request's
// check cannot read the same entry two ways.
async function writeOrigins(tx: TenantScopedDatabase, row: ClientOidcConfig): Promise<void> {
  await tx.delete(clientOrigins).where(eq(clientOrigins.clientId, row.clientId));
  const origins = [...expandWebOrigins(row.webOrigins, row.redirectUris)];
  if (origins.length === 0) return;
  await tx
    .insert(clientOrigins)
    .values(origins.map((origin) => ({ tenantId: row.tenantId, clientId: row.clientId, origin })));
}

export function clientOidcConfigRepository(tx: TenantScopedDatabase) {
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

    // One keyset page of the tenant's configs, by client id, for the command
    // that rewrites every client's origins.
    async page(after: string | undefined, limit: number): Promise<ClientOidcConfig[]> {
      const rows = await tx
        .select()
        .from(clientOidcConfig)
        .where(after === undefined ? undefined : gt(clientOidcConfig.clientId, after))
        .orderBy(asc(clientOidcConfig.clientId))
        .limit(limit);
      return rows.map(toRecord);
    },

    // Writes the client's origins again from the lists it holds.
    async rewriteOrigins(config: ClientOidcConfig): Promise<void> {
      await writeOrigins(tx, config);
    },

    async create(input: NewClientOidcConfig): Promise<ClientOidcConfig> {
      const rows = await tx
        .insert(clientOidcConfig)
        .values({
          clientId: input.clientId,
          tenantId: input.tenantId,
          redirectUris: input.redirectUris,
          grantTypes: input.grantTypes,
          tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
          audiences: input.audiences,
          accessTokenTtlSeconds: input.accessTokenTtlSeconds,
          idTokenTtlSeconds: input.idTokenTtlSeconds ?? null,
          refreshTokenTtlSeconds: input.refreshTokenTtlSeconds,
          clientCredentialsScopes: input.clientCredentialsScopes ?? [],
          webOrigins: input.webOrigins ?? [],
          postLogoutRedirectUris: input.postLogoutRedirectUris ?? [],
          jwks: input.jwks ?? null,
          jwksUri: input.jwksUri ?? null,
          frontchannelLogoutUri: input.frontchannelLogoutUri ?? null,
          backchannelLogoutUri: input.backchannelLogoutUri ?? null,
          backchannelLogoutSessionRequired: input.backchannelLogoutSessionRequired ?? false,
          frontchannelLogoutSessionRequired: input.frontchannelLogoutSessionRequired ?? false,
          consentRequired: input.consentRequired ?? false,
          tokenExchangeImpersonationAllowed: input.tokenExchangeImpersonationAllowed ?? false,
          userinfoSignedResponseAlg: input.userinfoSignedResponseAlg ?? null,
          userinfoEncryptedResponseAlg: input.userinfoEncryptedResponseAlg ?? null,
          userinfoEncryptedResponseEnc: input.userinfoEncryptedResponseEnc ?? null,
          tlsClientAuthSubjectDn: input.tlsClientAuthSubjectDn ?? null,
          clientUri: input.clientUri ?? null,
          policyUri: input.policyUri ?? null,
          tosUri: input.tosUri ?? null,
          idTokenSignedResponseAlg: input.idTokenSignedResponseAlg ?? null,
          defaultMaxAge: input.defaultMaxAge ?? null,
          requireAuthTime: input.requireAuthTime ?? false,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into client_oidc_config returned no row');
      }
      const created = toRecord(row);
      await writeOrigins(tx, created);
      return created;
    },

    // Every amendable `client_oidc_config` column
    // (client-patch.ts's `AMENDABLE_CLIENT_FIELDS`) in one statement — a
    // list field (`redirectUris`, `grantTypes`, `audiences`, `webOrigins`,
    // `postLogoutRedirectUris`, `clientCredentialsScopes`) replaces the
    // column wholesale, since `patch` carries exactly the arrays the
    // caller wants to keep, never a delta to append.
    async update(
      clientId: string,
      patch: Partial<Omit<typeof clientOidcConfig.$inferInsert, 'clientId' | 'tenantId'>>,
    ): Promise<ClientOidcConfig> {
      const rows = await tx
        .update(clientOidcConfig)
        .set(patch)
        .where(eq(clientOidcConfig.clientId, clientId))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`client_oidc_config for client ${clientId} not found while amending it`);
      }
      const updated = toRecord(row);
      if (patch.webOrigins !== undefined || patch.redirectUris !== undefined) {
        await writeOrigins(tx, updated);
      }
      return updated;
    },

    // The exact-match list logout's confirmation and redirect decision reads
    // — a narrow read of one column rather than the whole config, since the
    // logout usecase (`#/usecase/logout.ts`) needs nothing else about the
    // client.
    async postLogoutRedirectUris(clientId: string): Promise<readonly string[]> {
      const rows = await tx
        .select({ postLogoutRedirectUris: clientOidcConfig.postLogoutRedirectUris })
        .from(clientOidcConfig)
        .where(eq(clientOidcConfig.clientId, clientId));
      return rows[0]?.postLogoutRedirectUris ?? [];
    },

    // A CORS preflight carries no client identity, so the only allowlist
    // available at that moment is the tenant's union. The per-client list is
    // enforced on the real request, where the client is known. Joined to
    // `clients` and filtered to `enabled`: a client disabled because its
    // origin was compromised must not keep that origin working here. `origin`
    // is the normalised form `expandWebOrigins` produces; `client_origins`
    // (0096) holds each client's, written with its lists.
    async webOriginAllowed(origin: string): Promise<boolean> {
      // The origin's rows first, then each one's client, probed by key: left
      // to join them as it likes the planner may walk every client of every
      // tenant looking for the first with this origin.
      const rows = await tx.execute(sql`
        SELECT o.client_id
        FROM client_origins o
        CROSS JOIN LATERAL (
          SELECT 1 FROM clients c WHERE c.id = o.client_id AND c.enabled OFFSET 0
        ) enabled_client
        WHERE o.origin = ${origin}
        LIMIT 1
      `);
      return rows.length > 0;
    },
  };
}
