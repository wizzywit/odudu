import { type TenantScopedDatabase } from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clients,
  provisionClientDefaults,
  type ClientRecord,
} from '@odudu/domain-tenant';
import {
  clientOidcConfig,
  clientOidcConfigRepository,
  parseClientMetadata,
  type ClientOidcConfig,
} from '@odudu/protocol-oidc';
import { asc, eq, gt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { decodeCursor, encodeCursor } from '#/service/cursor';

const COLLECTION = 'clients';

const CLIENT_VIEW_COLUMNS = {
  id: clients.id,
  clientId: clients.clientId,
  name: clients.name,
  enabled: clients.enabled,
  type: clients.type,
  createdAt: clients.createdAt,
  fullScopeAllowed: clients.fullScopeAllowed,
  registrationOrigin: clients.registrationOrigin,
  redirectUris: clientOidcConfig.redirectUris,
  grantTypes: clientOidcConfig.grantTypes,
  tokenEndpointAuthMethod: clientOidcConfig.tokenEndpointAuthMethod,
  audiences: clientOidcConfig.audiences,
  accessTokenTtlSeconds: clientOidcConfig.accessTokenTtlSeconds,
  refreshTokenTtlSeconds: clientOidcConfig.refreshTokenTtlSeconds,
  clientCredentialsScopes: clientOidcConfig.clientCredentialsScopes,
  webOrigins: clientOidcConfig.webOrigins,
  postLogoutRedirectUris: clientOidcConfig.postLogoutRedirectUris,
  jwks: clientOidcConfig.jwks,
  jwksUri: clientOidcConfig.jwksUri,
  frontchannelLogoutUri: clientOidcConfig.frontchannelLogoutUri,
  backchannelLogoutUri: clientOidcConfig.backchannelLogoutUri,
  frontchannelLogoutSessionRequired: clientOidcConfig.frontchannelLogoutSessionRequired,
  backchannelLogoutSessionRequired: clientOidcConfig.backchannelLogoutSessionRequired,
  consentRequired: clientOidcConfig.consentRequired,
  tokenExchangeImpersonationAllowed: clientOidcConfig.tokenExchangeImpersonationAllowed,
  userinfoSignedResponseAlg: clientOidcConfig.userinfoSignedResponseAlg,
  userinfoEncryptedResponseAlg: clientOidcConfig.userinfoEncryptedResponseAlg,
  userinfoEncryptedResponseEnc: clientOidcConfig.userinfoEncryptedResponseEnc,
  tlsClientAuthSubjectDn: clientOidcConfig.tlsClientAuthSubjectDn,
};

// The client and its OIDC configuration, joined into the one resource an
// admin caller reads — `secret_hash` is deliberately absent: it is never
// selected, so it can never leak through an unmapped field.
export interface ClientView {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly type: ClientRecord['type'];
  readonly createdAt: Date;
  readonly fullScopeAllowed: boolean;
  readonly registrationOrigin: ClientRecord['registrationOrigin'];
  readonly redirectUris: string[];
  readonly grantTypes: string[];
  readonly tokenEndpointAuthMethod: ClientOidcConfig['tokenEndpointAuthMethod'];
  readonly audiences: string[];
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly clientCredentialsScopes: string[];
  readonly webOrigins: string[];
  readonly postLogoutRedirectUris: string[];
  readonly jwks: unknown;
  readonly jwksUri: string | null;
  readonly frontchannelLogoutUri: string | null;
  readonly backchannelLogoutUri: string | null;
  readonly frontchannelLogoutSessionRequired: boolean;
  readonly backchannelLogoutSessionRequired: boolean;
  readonly consentRequired: boolean;
  readonly tokenExchangeImpersonationAllowed: boolean;
  readonly userinfoSignedResponseAlg: string | null;
  readonly userinfoEncryptedResponseAlg: string | null;
  readonly userinfoEncryptedResponseEnc: string | null;
  readonly tlsClientAuthSubjectDn: string | null;
}

function clientsJoinedWithConfig(tx: TenantScopedDatabase) {
  return tx
    .select(CLIENT_VIEW_COLUMNS)
    .from(clients)
    .innerJoin(clientOidcConfig, eq(clients.id, clientOidcConfig.clientId));
}

// `type`, `registration_origin` and `token_endpoint_auth_method` are plain
// `text` columns (clients_secret_matches_type and
// client_oidc_config_auth_method_check are what actually bound them) — a
// raw select reads them back as `string`, the same narrowing
// `clientRepository`'s and `clientOidcConfigRepository`'s own `toRecord`
// apply.
function narrowRow(row: Awaited<ReturnType<typeof clientsJoinedWithConfig>>[number]): ClientView {
  return {
    ...row,
    type: row.type as ClientView['type'],
    registrationOrigin: row.registrationOrigin as ClientView['registrationOrigin'],
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod as ClientView['tokenEndpointAuthMethod'],
  };
}

export interface ClientAuditEvent {
  readonly action: 'client.create';
  readonly resourceType: 'client';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: ClientAuditEvent) => Promise<void>;

export interface ListClientsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
}

export type ListClientsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly ClientView[]; next: string | null };

export async function listClients(
  tx: TenantScopedDatabase,
  input: ListClientsInput,
): Promise<ListClientsOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await clientsJoinedWithConfig(tx)
    .where(after === undefined ? undefined : gt(clients.id, after))
    .orderBy(asc(clients.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map(narrowRow);
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: COLLECTION,
          tenantId: input.tenantId,
        })
      : null;

  return { kind: 'ok', items, next };
}

export type ReadClientOutcome = { kind: 'not_found' } | { kind: 'ok'; client: ClientView };

export async function readClient(
  tx: TenantScopedDatabase,
  clientDbId: string,
): Promise<ReadClientOutcome> {
  const rows = await clientsJoinedWithConfig(tx).where(eq(clients.id, clientDbId));
  const row = rows[0];
  return row === undefined ? { kind: 'not_found' } : { kind: 'ok', client: narrowRow(row) };
}

export interface CreateClientInput {
  readonly clientId: string;
  // RFC 7591 client metadata, as the caller sent it (minus `client_id`,
  // which this door lets an operator choose and dynamic registration does
  // not) — narrowed by `parseClientMetadata`, never read by hand.
  readonly metadata: unknown;
  readonly tenantId: string;
  readonly actorSubjectId: string;
}

export interface CreateClientDeps {
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly tlsClientAuthEnabled: boolean;
  readonly audit: Audit;
}

export type CreateClientOutcome =
  | { kind: 'reserved_client_id' }
  | {
      kind: 'invalid_metadata';
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    }
  | { kind: 'ok'; client: ClientView; secret: string | null };

// RFC 7591 places no format requirement on a client secret; 32 random
// bytes base64url-encoded matches dynamic registration's own choice
// (`generateClientSecret`, `#/usecase/client-registration.ts` in
// @odudu/protocol-oidc) — 256 bits of entropy, comfortably above what a
// bearer credential needs.
function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

function clientType(tokenEndpointAuthMethod: string): 'public' | 'confidential' {
  return tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
}

function toClientView(client: ClientRecord, config: ClientOidcConfig): ClientView {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    enabled: client.enabled,
    type: client.type,
    createdAt: client.createdAt,
    fullScopeAllowed: client.fullScopeAllowed,
    registrationOrigin: client.registrationOrigin,
    redirectUris: config.redirectUris,
    grantTypes: config.grantTypes,
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
    audiences: config.audiences,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
    clientCredentialsScopes: config.clientCredentialsScopes,
    webOrigins: config.webOrigins,
    postLogoutRedirectUris: config.postLogoutRedirectUris,
    jwks: config.jwks,
    jwksUri: config.jwksUri,
    frontchannelLogoutUri: config.frontchannelLogoutUri,
    backchannelLogoutUri: config.backchannelLogoutUri,
    frontchannelLogoutSessionRequired: config.frontchannelLogoutSessionRequired,
    backchannelLogoutSessionRequired: config.backchannelLogoutSessionRequired,
    consentRequired: config.consentRequired,
    tokenExchangeImpersonationAllowed: config.tokenExchangeImpersonationAllowed,
    userinfoSignedResponseAlg: config.userinfoSignedResponseAlg,
    userinfoEncryptedResponseAlg: config.userinfoEncryptedResponseAlg,
    userinfoEncryptedResponseEnc: config.userinfoEncryptedResponseEnc,
    tlsClientAuthSubjectDn: config.tlsClientAuthSubjectDn,
  };
}

// `odudu-admin` is reserved for the built-in admin client every tenant is
// provisioned with (`provisionAdminClient`, @odudu/protocol-oidc):
// `provisionAdminClient` itself refuses to *adopt* a client that already
// carries this id but is not the real thing (`admin_client_not_builtin`,
// @odudu/domain-tenant), but that guard only fires when a tenant is
// provisioned. Creation through this door is refused up front instead.
export async function createClient(
  tx: TenantScopedDatabase,
  deps: CreateClientDeps,
  input: CreateClientInput,
): Promise<CreateClientOutcome> {
  if (input.clientId === ADMIN_CLIENT_ID) {
    return { kind: 'reserved_client_id' };
  }

  const parsed = parseClientMetadata(input.metadata, {
    tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
  });
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid_metadata', error: parsed.error, description: parsed.description };
  }
  const metadata = parsed.metadata;
  const type = clientType(metadata.tokenEndpointAuthMethod);

  let serviceSubjectId: string | null = null;
  if (type === 'confidential') {
    const serviceSubject = await subjectRepository(tx).create({
      tenantId: input.tenantId,
      type: 'service',
    });
    serviceSubjectId = serviceSubject.id;
  }

  const secret = type === 'confidential' ? generateClientSecret() : null;
  const secretHash = secret === null ? null : await deps.hashClientSecret(secret);

  const client = await clientRepository(tx).create({
    tenantId: input.tenantId,
    clientId: input.clientId,
    name: metadata.clientName ?? input.clientId,
    type,
    secretHash,
    serviceSubjectId,
    registrationOrigin: 'seeded',
  });

  await provisionClientDefaults(tx, client.id);

  const config = await clientOidcConfigRepository(tx).create({
    clientId: client.id,
    tenantId: input.tenantId,
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
    redirectUris: metadata.redirectUris,
    grantTypes: metadata.grantTypes,
    tokenEndpointAuthMethod:
      metadata.tokenEndpointAuthMethod as ClientOidcConfig['tokenEndpointAuthMethod'],
    jwks: metadata.jwks,
    jwksUri: metadata.jwksUri,
    frontchannelLogoutUri: metadata.frontchannelLogoutUri,
    backchannelLogoutUri: metadata.backchannelLogoutUri,
    backchannelLogoutSessionRequired: metadata.backchannelLogoutSessionRequired,
    frontchannelLogoutSessionRequired: metadata.frontchannelLogoutSessionRequired,
    userinfoSignedResponseAlg: metadata.userinfoSignedResponseAlg,
    userinfoEncryptedResponseAlg: metadata.userinfoEncryptedResponseAlg,
    userinfoEncryptedResponseEnc: metadata.userinfoEncryptedResponseEnc,
    tlsClientAuthSubjectDn: metadata.tlsClientAuthSubjectDn,
  });

  await deps.audit({
    action: 'client.create',
    resourceType: 'client',
    resourceId: client.id,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ok', client: toClientView(client, config), secret };
}
