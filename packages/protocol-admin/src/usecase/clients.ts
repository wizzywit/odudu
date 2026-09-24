import { type Client } from '@odudu/contracts/admin';
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
import { AMENDABLE_CLIENT_FIELDS, refusalFor } from '#/service/client-patch';
import { etagOf, matches } from '#/service/etag';

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
  readonly action: 'client.create' | 'client.amend' | 'client.delete' | 'client.rotate_secret';
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

// `ClientIdConflictError` (@odudu/domain-tenant) propagates out of
// `createClient` instead of appearing in this union — see the comment
// beside its `create` call for why it cannot be caught and returned from
// inside the transaction.
export type CreateClientOutcome =
  | { kind: 'reserved_client_id' }
  | {
      kind: 'invalid_metadata';
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    }
  | { kind: 'at_capacity' }
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

  // Locked and counted the same way `registerClient` gates dynamic
  // registration (`packages/protocol-oidc/src/usecase/client-registration.ts`)
  // — the holder of `manage-clients` is not the holder of `manage-tenant`,
  // which is what sets `max_clients`, so this door needs its own check
  // rather than trusting the two capabilities to be held together.
  const capacity = await clientRepository(tx).lockCapacity(input.tenantId);
  if (capacity.count >= capacity.maxClients) {
    return { kind: 'at_capacity' };
  }

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

  // `ClientIdConflictError` is left to propagate out of this function,
  // never caught and turned into a returned outcome: by the time the
  // unique-index violation fires, the INSERT has already left this
  // transaction aborted, and postgres.js discards whatever this function
  // resolves with and throws the raw driver error regardless — the same
  // reason `AmendSettingsRefusedError` (#/usecase/settings.ts) is thrown
  // rather than returned. The route catches it outside `withTenant`.
  const client = await clientRepository(tx).create({
    tenantId: input.tenantId,
    clientId: input.clientId,
    name: metadata.clientName ?? input.clientId,
    type,
    secretHash,
    serviceSubjectId,
    // Distinct from the CLI's 'seeded' and dynamic registration's
    // 'anonymous'/'token': an operator naming a client_id through this
    // door is a provenance this record can state honestly, rather than
    // folding it into 'seeded' and making the two indistinguishable.
    registrationOrigin: 'operator',
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

// The wire shape a caller reads back, and what an `ETag` is hashed over —
// the same mapping on a `GET` (view/routes/clients.ts's `toWireClient`
// delegates here) and on the read `amendClient` does before writing, so an
// `If-Match` taken from one always compares against the other.
export function clientWireShape(view: ClientView): Client {
  return {
    id: view.id,
    client_id: view.clientId,
    name: view.name,
    type: view.type,
    enabled: view.enabled,
    full_scope_allowed: view.fullScopeAllowed,
    registration_origin: view.registrationOrigin,
    created_at: view.createdAt.toISOString(),
    redirect_uris: view.redirectUris,
    grant_types: view.grantTypes,
    token_endpoint_auth_method: view.tokenEndpointAuthMethod,
    audiences: view.audiences,
    access_token_ttl_seconds: view.accessTokenTtlSeconds,
    refresh_token_ttl_seconds: view.refreshTokenTtlSeconds,
    client_credentials_scopes: view.clientCredentialsScopes,
    web_origins: view.webOrigins,
    post_logout_redirect_uris: view.postLogoutRedirectUris,
    jwks: view.jwks,
    jwks_uri: view.jwksUri,
    frontchannel_logout_uri: view.frontchannelLogoutUri,
    backchannel_logout_uri: view.backchannelLogoutUri,
    frontchannel_logout_session_required: view.frontchannelLogoutSessionRequired,
    backchannel_logout_session_required: view.backchannelLogoutSessionRequired,
    consent_required: view.consentRequired,
    token_exchange_impersonation_allowed: view.tokenExchangeImpersonationAllowed,
    userinfo_signed_response_alg: view.userinfoSignedResponseAlg,
    userinfo_encrypted_response_alg: view.userinfoEncryptedResponseAlg,
    userinfo_encrypted_response_enc: view.userinfoEncryptedResponseEnc,
    tls_client_auth_subject_dn: view.tlsClientAuthSubjectDn,
  };
}

export interface AmendClientInput {
  readonly clientDbId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
}

export interface AmendClientDeps {
  readonly tlsClientAuthEnabled: boolean;
  readonly audit: Audit;
}

export type AmendClientOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | {
      kind: 'invalid_metadata';
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    }
  | { kind: 'precondition_required'; field: string }
  | { kind: 'precondition_failed' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | { kind: 'ok'; client: ClientView; etag: string };

// Narrowing any of these on the built-in admin client can lock every
// administrator out while the client stays enabled — the same lockout
// `enabled: false` produces, through a second door.
const BUILTIN_ADMIN_LOCKOUT_FIELDS = ['grant_types', 'token_endpoint_auth_method', 'redirect_uris'];

// The six list fields the schema stores whole (the same six
// `clientOidcConfigRepository.update`'s own comment names): last-write-wins
// on one silently reinstates exactly what another admin just removed, so a
// `PATCH` naming any of them must carry `If-Match` — checked by name below,
// never through one representative.
const WHOLESALE_LIST_FIELDS = [
  'redirect_uris',
  'post_logout_redirect_uris',
  'web_origins',
  'audiences',
  'grant_types',
  'client_credentials_scopes',
] as const;

// RFC 7591 client metadata this amendment reruns through
// `parseClientMetadata` before it writes — everything else amendable is
// admin-only configuration the registration validator has no opinion on.
const METADATA_FIELDS = new Set<string>([
  'redirect_uris',
  'grant_types',
  'token_endpoint_auth_method',
  'jwks',
  'jwks_uri',
  'frontchannel_logout_uri',
  'backchannel_logout_uri',
  'backchannel_logout_session_required',
  'frontchannel_logout_session_required',
  'userinfo_signed_response_alg',
  'userinfo_encrypted_response_alg',
  'userinfo_encrypted_response_enc',
  'tls_client_auth_subject_dn',
]);

interface FieldError {
  readonly field: string;
  readonly description: string;
}

function isFieldError(value: unknown): value is FieldError {
  return typeof value === 'object' && value !== null && 'field' in value && 'description' in value;
}

function checkedString(field: string, value: unknown): string | FieldError {
  return typeof value === 'string' ? value : { field, description: `${field} must be a string` };
}

function checkedBoolean(field: string, value: unknown): boolean | FieldError {
  return typeof value === 'boolean' ? value : { field, description: `${field} must be a boolean` };
}

function checkedInteger(field: string, value: unknown): number | FieldError {
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : { field, description: `${field} must be an integer` };
}

function checkedStringArray(field: string, value: unknown): string[] | FieldError {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : { field, description: `${field} must be an array of strings` };
}

// `undefined` when `key` is absent from `patch` (falls back to `current`),
// and `undefined` in place of a literal `null` either way —
// `parseClientMetadata`'s shape treats an unset field as absent, never as
// `null`.
function metadataFieldValue(
  patch: Readonly<Record<string, unknown>>,
  key: string,
  current: unknown,
): unknown {
  const effective = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current;
  return effective === null ? undefined : effective;
}

/**
 * Splits the supplied fields across `clients` and `client_oidc_config` in
 * one transaction, replacing every list field wholesale — never appending —
 * and running the amended RFC 7591 metadata through `parseClientMetadata`
 * before the write. `If-Match` is required, answering `428`, on a `PATCH`
 * that touches any of the five wholesale list fields; optional otherwise.
 */
export async function amendClient(
  tx: TenantScopedDatabase,
  deps: AmendClientDeps,
  input: AmendClientInput,
): Promise<AmendClientOutcome> {
  // Locked for the rest of the transaction, so the `If-Match` comparison
  // below and the writes that follow it cannot interleave with another
  // amendment of the same client — the config row is reached only through
  // this one, so locking it serialises both halves of the resource.
  const clientRow = await clientRepository(tx).byIdForUpdate(input.clientDbId);
  if (clientRow === null) return { kind: 'not_found' };

  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_CLIENT_FIELDS.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field) ?? `${field} is not a client field`,
      };
    }
  }

  // Reads `builtinAdmin`, not `client_id` — a client renamed directly in
  // the database still carries this column, so it cannot slip past the
  // check that way.
  if (clientRow.builtinAdmin) {
    if (input.values.enabled === false) {
      return {
        kind: 'builtin_admin_guarded',
        reason: `${clientRow.clientId} is this tenant's built-in admin client and cannot be disabled`,
      };
    }
    const lockoutField = BUILTIN_ADMIN_LOCKOUT_FIELDS.find((field) => field in input.values);
    if (lockoutField !== undefined) {
      return {
        kind: 'builtin_admin_guarded',
        reason: `${lockoutField} on ${clientRow.clientId}, this tenant's built-in admin client, would lock administrators out`,
      };
    }
  }

  const configRow = await clientOidcConfigRepository(tx).byClientId(input.clientDbId);
  if (configRow === null) {
    throw new Error(`client ${input.clientDbId} has no client_oidc_config row`);
  }

  const clientPatch: Partial<
    Pick<typeof clients.$inferInsert, 'name' | 'enabled' | 'fullScopeAllowed'>
  > = {};
  const configPatch: Partial<Omit<typeof clientOidcConfig.$inferInsert, 'clientId' | 'tenantId'>> =
    {};

  if ('name' in input.values) {
    const checked = checkedString('name', input.values.name);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    clientPatch.name = checked;
  }
  if ('enabled' in input.values) {
    const checked = checkedBoolean('enabled', input.values.enabled);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    clientPatch.enabled = checked;
  }
  if ('full_scope_allowed' in input.values) {
    const checked = checkedBoolean('full_scope_allowed', input.values.full_scope_allowed);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    clientPatch.fullScopeAllowed = checked;
  }

  for (const field of [
    'audiences',
    'web_origins',
    'post_logout_redirect_uris',
    'client_credentials_scopes',
  ] as const) {
    if (!(field in input.values)) continue;
    const checked = checkedStringArray(field, input.values[field]);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    if (field === 'audiences') configPatch.audiences = checked;
    else if (field === 'web_origins') configPatch.webOrigins = checked;
    else if (field === 'post_logout_redirect_uris') configPatch.postLogoutRedirectUris = checked;
    else configPatch.clientCredentialsScopes = checked;
  }
  for (const field of ['access_token_ttl_seconds', 'refresh_token_ttl_seconds'] as const) {
    if (!(field in input.values)) continue;
    const checked = checkedInteger(field, input.values[field]);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    if (field === 'access_token_ttl_seconds') configPatch.accessTokenTtlSeconds = checked;
    else configPatch.refreshTokenTtlSeconds = checked;
  }
  for (const field of ['consent_required', 'token_exchange_impersonation_allowed'] as const) {
    if (!(field in input.values)) continue;
    const checked = checkedBoolean(field, input.values[field]);
    if (isFieldError(checked)) return { kind: 'invalid_value', ...checked };
    if (field === 'consent_required') configPatch.consentRequired = checked;
    else configPatch.tokenExchangeImpersonationAllowed = checked;
  }

  const touchesMetadata = [...METADATA_FIELDS].some((field) => field in input.values);
  if (touchesMetadata) {
    const merged = {
      redirect_uris: metadataFieldValue(input.values, 'redirect_uris', configRow.redirectUris),
      grant_types: metadataFieldValue(input.values, 'grant_types', configRow.grantTypes),
      token_endpoint_auth_method: metadataFieldValue(
        input.values,
        'token_endpoint_auth_method',
        configRow.tokenEndpointAuthMethod,
      ),
      jwks: metadataFieldValue(input.values, 'jwks', configRow.jwks),
      jwks_uri: metadataFieldValue(input.values, 'jwks_uri', configRow.jwksUri),
      frontchannel_logout_uri: metadataFieldValue(
        input.values,
        'frontchannel_logout_uri',
        configRow.frontchannelLogoutUri,
      ),
      backchannel_logout_uri: metadataFieldValue(
        input.values,
        'backchannel_logout_uri',
        configRow.backchannelLogoutUri,
      ),
      backchannel_logout_session_required: metadataFieldValue(
        input.values,
        'backchannel_logout_session_required',
        configRow.backchannelLogoutSessionRequired,
      ),
      frontchannel_logout_session_required: metadataFieldValue(
        input.values,
        'frontchannel_logout_session_required',
        configRow.frontchannelLogoutSessionRequired,
      ),
      userinfo_signed_response_alg: metadataFieldValue(
        input.values,
        'userinfo_signed_response_alg',
        configRow.userinfoSignedResponseAlg,
      ),
      userinfo_encrypted_response_alg: metadataFieldValue(
        input.values,
        'userinfo_encrypted_response_alg',
        configRow.userinfoEncryptedResponseAlg,
      ),
      userinfo_encrypted_response_enc: metadataFieldValue(
        input.values,
        'userinfo_encrypted_response_enc',
        configRow.userinfoEncryptedResponseEnc,
      ),
      tls_client_auth_subject_dn: metadataFieldValue(
        input.values,
        'tls_client_auth_subject_dn',
        configRow.tlsClientAuthSubjectDn,
      ),
    };

    const parsed = parseClientMetadata(merged, { tlsClientAuthEnabled: deps.tlsClientAuthEnabled });
    if (parsed.kind === 'invalid') {
      return { kind: 'invalid_metadata', error: parsed.error, description: parsed.description };
    }

    configPatch.redirectUris = parsed.metadata.redirectUris;
    configPatch.grantTypes = parsed.metadata.grantTypes;
    configPatch.tokenEndpointAuthMethod = parsed.metadata.tokenEndpointAuthMethod;
    configPatch.jwks = parsed.metadata.jwks;
    configPatch.jwksUri = parsed.metadata.jwksUri;
    configPatch.frontchannelLogoutUri = parsed.metadata.frontchannelLogoutUri;
    configPatch.backchannelLogoutUri = parsed.metadata.backchannelLogoutUri;
    configPatch.backchannelLogoutSessionRequired = parsed.metadata.backchannelLogoutSessionRequired;
    configPatch.frontchannelLogoutSessionRequired =
      parsed.metadata.frontchannelLogoutSessionRequired;
    configPatch.userinfoSignedResponseAlg = parsed.metadata.userinfoSignedResponseAlg;
    configPatch.userinfoEncryptedResponseAlg = parsed.metadata.userinfoEncryptedResponseAlg;
    configPatch.userinfoEncryptedResponseEnc = parsed.metadata.userinfoEncryptedResponseEnc;
    configPatch.tlsClientAuthSubjectDn = parsed.metadata.tlsClientAuthSubjectDn;
  }

  const requiredIfMatchField = WHOLESALE_LIST_FIELDS.find((field) => field in input.values);
  if (requiredIfMatchField !== undefined && input.ifMatch === undefined) {
    return { kind: 'precondition_required', field: requiredIfMatchField };
  }

  const currentView = toClientView(clientRow, configRow);
  const currentEtag = etagOf(clientWireShape(currentView));
  if (matches(input.ifMatch, currentEtag) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  const updatedClientRow =
    Object.keys(clientPatch).length === 0
      ? clientRow
      : await clientRepository(tx).update(input.clientDbId, clientPatch);
  const updatedConfigRow =
    Object.keys(configPatch).length === 0
      ? configRow
      : await clientOidcConfigRepository(tx).update(input.clientDbId, configPatch);

  await deps.audit({
    action: 'client.amend',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
  });

  const view = toClientView(updatedClientRow, updatedConfigRow);
  return { kind: 'ok', client: view, etag: etagOf(clientWireShape(view)) };
}

export interface RotateClientSecretInput {
  readonly clientDbId: string;
  readonly actorSubjectId: string;
}

export interface RotateClientSecretDeps {
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly audit: Audit;
}

export type RotateClientSecretOutcome =
  | { kind: 'not_found' }
  | { kind: 'not_confidential' }
  | { kind: 'ok'; client: ClientView; secret: string };

/** Answers the new secret exactly once — nothing reads it back afterward. */
export async function rotateClientSecret(
  tx: TenantScopedDatabase,
  deps: RotateClientSecretDeps,
  input: RotateClientSecretInput,
): Promise<RotateClientSecretOutcome> {
  const clientRow = await clientRepository(tx).byId(input.clientDbId);
  if (clientRow === null) return { kind: 'not_found' };
  if (clientRow.type !== 'confidential') return { kind: 'not_confidential' };

  const secret = generateClientSecret();
  const secretHash = await deps.hashClientSecret(secret);
  const updatedClientRow = await clientRepository(tx).rotateSecret(input.clientDbId, secretHash);

  await deps.audit({
    action: 'client.rotate_secret',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
  });

  const configRow = await clientOidcConfigRepository(tx).byClientId(input.clientDbId);
  if (configRow === null) {
    throw new Error(`client ${input.clientDbId} has no client_oidc_config row`);
  }
  return { kind: 'ok', client: toClientView(updatedClientRow, configRow), secret };
}

export interface DeleteClientInput {
  readonly clientDbId: string;
  readonly actorSubjectId: string;
}

export interface DeleteClientDeps {
  readonly audit: Audit;
}

export type DeleteClientOutcome =
  { kind: 'not_found' } | { kind: 'builtin_admin_guarded'; reason: string } | { kind: 'deleted' };

export async function deleteClient(
  tx: TenantScopedDatabase,
  deps: DeleteClientDeps,
  input: DeleteClientInput,
): Promise<DeleteClientOutcome> {
  const clientRow = await clientRepository(tx).byId(input.clientDbId);
  if (clientRow === null) return { kind: 'not_found' };
  if (clientRow.builtinAdmin) {
    return {
      kind: 'builtin_admin_guarded',
      reason: `${clientRow.clientId} is this tenant's built-in admin client and cannot be deleted`,
    };
  }

  await clientRepository(tx).delete(input.clientDbId);

  await deps.audit({
    action: 'client.delete',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'deleted' };
}
