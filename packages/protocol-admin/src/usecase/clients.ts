import {
  type ADMIN_CAPABILITIES,
  CLIENT_LIST_LIMIT,
  listLimitMessage,
  type Client,
  type ClientFields,
  type ListClientsQuery,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { roles } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clients,
  clientScopeAssignments,
  clientScopes,
  provisionClientDefaults,
  type ClientRecord,
  type ClientScopeAssignment,
} from '@odudu/domain-tenant';
import {
  clientOidcConfig,
  clientOidcConfigRepository,
  clientTokenTtlProblem,
  idTokenAlgUnavailable,
  isWellFormedWebOrigin,
  parseClientMetadata,
  type ClientOidcConfig,
} from '@odudu/protocol-oidc';
import { and, asc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { redactedDiff } from '#/service/audit-detail';
import {
  adminReachOfSubjects,
  capabilitiesReachableFrom,
  overreach,
} from '#/service/capability-ceiling';
import { checkDescription } from '#/service/description';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { readKeyedPage } from '#/service/in-order';
import {
  AMENDABLE_CLIENT_FIELDS,
  BUILTIN_ADMIN_AMENDABLE_FIELDS,
  refusalFor,
} from '#/service/client-patch';
import { etagOf, matches } from '#/service/etag';
import { publicJwks } from '#/service/public-jwks';
import {
  guardLastAdministrator,
  type LastAdministratorRefusal,
} from '#/usecase/last-administrator';
import {
  prefixRangeConditions,
  requireSearchKey,
  type ListPosition,
} from '#/usecase/prefix-search';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingInput,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

const COLLECTION = 'clients';

const CLIENT_VIEW_COLUMNS = {
  id: clients.id,
  clientId: clients.clientId,
  name: clients.name,
  description: clients.description,
  enabled: clients.enabled,
  type: clients.type,
  createdAt: clients.createdAt,
  fullScopeAllowed: clients.fullScopeAllowed,
  registrationOrigin: clients.registrationOrigin,
  builtinAdmin: clients.builtinAdmin,
  serviceSubjectId: clients.serviceSubjectId,
  redirectUris: clientOidcConfig.redirectUris,
  grantTypes: clientOidcConfig.grantTypes,
  tokenEndpointAuthMethod: clientOidcConfig.tokenEndpointAuthMethod,
  audiences: clientOidcConfig.audiences,
  accessTokenTtlSeconds: clientOidcConfig.accessTokenTtlSeconds,
  idTokenTtlSeconds: clientOidcConfig.idTokenTtlSeconds,
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
  clientUri: clientOidcConfig.clientUri,
  policyUri: clientOidcConfig.policyUri,
  tosUri: clientOidcConfig.tosUri,
  idTokenSignedResponseAlg: clientOidcConfig.idTokenSignedResponseAlg,
  defaultMaxAge: clientOidcConfig.defaultMaxAge,
  requireAuthTime: clientOidcConfig.requireAuthTime,
  previousSecretExpiresAt: clients.previousSecretExpiresAt,
};

// The client and its OIDC configuration, joined into the one resource an
// admin caller reads — `secret_hash` is deliberately absent: it is never
// selected, so it can never leak through an unmapped field.
export interface ClientView {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly description: string | null;
  readonly enabled: boolean;
  readonly type: ClientRecord['type'];
  readonly createdAt: Date;
  readonly fullScopeAllowed: boolean;
  readonly registrationOrigin: ClientRecord['registrationOrigin'];
  readonly builtinAdmin: boolean;
  readonly serviceSubjectId: string | null;
  readonly redirectUris: string[];
  readonly grantTypes: string[];
  readonly tokenEndpointAuthMethod: ClientOidcConfig['tokenEndpointAuthMethod'];
  readonly audiences: string[];
  readonly accessTokenTtlSeconds: number | null;
  readonly idTokenTtlSeconds: number | null;
  readonly refreshTokenTtlSeconds: number | null;
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
  readonly clientUri: string | null;
  readonly policyUri: string | null;
  readonly tosUri: string | null;
  readonly idTokenSignedResponseAlg: string | null;
  readonly defaultMaxAge: number | null;
  readonly requireAuthTime: boolean;
  readonly previousSecretExpiresAt: Date | null;
  readonly scopes: readonly ClientScopeAssignmentView[];
  // Derived on every read and outside the ETag; empty without a service account.
  readonly serviceAccountAdminReach: readonly (typeof ADMIN_CAPABILITIES)[number][];
}

type StoredView = Omit<ClientView, 'scopes' | 'serviceAccountAdminReach'>;

export interface ClientScopeAssignmentView {
  readonly id: string;
  readonly name: string;
  readonly assignment: ClientScopeAssignment;
}

// A batched read, never one query per client: `listClients` would
// otherwise issue one extra round trip per row on the page, the same N+1
// a page of sessions was found doing before its own query was batched.
async function scopesForClients(
  tx: TenantScopedDatabase,
  clientIds: readonly string[],
): Promise<Map<string, ClientScopeAssignmentView[]>> {
  const map = new Map<string, ClientScopeAssignmentView[]>();
  if (clientIds.length === 0) return map;

  const rows = await tx
    .select({
      clientId: clientScopeAssignments.clientId,
      id: clientScopes.id,
      name: clientScopes.name,
      assignment: clientScopeAssignments.assignment,
    })
    .from(clientScopeAssignments)
    .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
    .where(inArray(clientScopeAssignments.clientId, [...clientIds]));

  for (const row of rows) {
    const list = map.get(row.clientId) ?? [];
    list.push({ id: row.id, name: row.name, assignment: row.assignment });
    map.set(row.clientId, list);
  }
  return map;
}

async function attachScopes(tx: TenantScopedDatabase, view: StoredView): Promise<ClientView> {
  const [attached] = await attachScopesMany(tx, [view]);
  if (attached === undefined) throw new Error('protocol-admin: a client view was not attached');
  return attached;
}

// Scopes and reach each in one query for the whole page, never one per client.
async function attachScopesMany(
  tx: TenantScopedDatabase,
  views: readonly StoredView[],
): Promise<ClientView[]> {
  const scopesByClient = await scopesForClients(
    tx,
    views.map((view) => view.id),
  );
  const reach = await adminReachOfSubjects(
    tx,
    views.flatMap((view) => (view.serviceSubjectId === null ? [] : [view.serviceSubjectId])),
  );
  return views.map((view) => ({
    ...view,
    scopes: scopesByClient.get(view.id) ?? [],
    serviceAccountAdminReach:
      view.serviceSubjectId === null ? [] : (reach.get(view.serviceSubjectId) ?? []),
  }));
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
function narrowRow(row: Awaited<ReturnType<typeof clientsJoinedWithConfig>>[number]): StoredView {
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
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: ClientAuditEvent) => Promise<void>;

/** The caller of a client mutation, as the target ceiling on its service account reads it. */
export type ClientCeilingCaller = Omit<TargetCeilingInput, 'subjectId'>;

// A confidential client authenticates as its service account, so a route
// that mutates the client is a route that can take that subject over: its
// secret, its keys, its audiences. Held to the target ceiling on that
// subject, the refusal filed on `resource`. Takes the subject's lock before
// the caller locks the client, the order deleting the subject takes them in
// (`clients_service_subject_fk` sets the column null).
export async function refuseOverServiceAccountCeiling<A extends string, R extends string>(
  tx: TenantScopedDatabase,
  audit: Parameters<typeof refuseOverTargetCeiling<A, R>>[1],
  action: A,
  serviceSubjectId: string | null,
  caller: ClientCeilingCaller,
  resource: { readonly type: R; readonly id: string },
): Promise<TargetCeilingRefusal | null> {
  if (serviceSubjectId === null) return null;
  if (!(await lockSubjectRow(tx, serviceSubjectId))) return null;
  return refuseOverTargetCeiling(
    tx,
    audit,
    action,
    { ...caller, subjectId: serviceSubjectId },
    resource,
  );
}

/** Every `listClientsQuerySchema` parameter except the page controls. */
export type ClientFilters = Omit<ListClientsQuery, 'cursor' | 'limit'>;

export interface ListClientsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
  readonly filters: ClientFilters;
}

export type ListClientsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly ClientView[]; next: string | null };

type ClientSearchKey = typeof clients.clientIdSearch | typeof clients.nameSearch;

function clientSearchOf(
  filters: ClientFilters,
): { readonly column: ClientSearchKey; readonly prefix: string } | undefined {
  if (filters.client_id !== undefined) {
    return { column: clients.clientIdSearch, prefix: filters.client_id };
  }
  if (filters.name !== undefined) return { column: clients.nameSearch, prefix: filters.name };
  return undefined;
}

function exactClientConditions(filters: ClientFilters): SQL[] {
  return [
    ...(filters.client_id_exact === undefined
      ? []
      : [eq(clients.clientId, filters.client_id_exact)]),
    ...(filters.type === undefined ? [] : [eq(clients.type, filters.type)]),
    ...(filters.enabled === undefined ? [] : [eq(clients.enabled, filters.enabled === 'true')]),
  ];
}

/**
 * The WHERE clause of the clients listing, and so also of its count, which
 * passes no position. It reads `clients` columns only, so the count needs
 * none of the listing's join to `client_oidc_config`.
 */
export async function clientListConditions(
  tx: TenantScopedDatabase,
  filters: ClientFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions = exactClientConditions(filters);
  const search = clientSearchOf(filters);
  if (search === undefined) {
    if (after !== undefined) conditions.push(gt(clients.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(tx, search.column, clients.id, search.prefix, position)),
  );
  return conditions;
}

/** The clients listing's order, which its keyset cursor and its count both follow. */
export function clientListOrder(filters: ClientFilters): SQL[] {
  const search = clientSearchOf(filters);
  return search === undefined ? [asc(clients.id)] : [asc(search.column), asc(clients.id)];
}

// A searched listing is one range scan of the search column's index
// (0074_list_indexes_tenants_clients.sql), the way `listSubjects` is.
export async function listClients(
  tx: TenantScopedDatabase,
  input: ListClientsInput,
): Promise<ListClientsOutcome> {
  const filters = filterDigest(input.filters);
  const search = clientSearchOf(input.filters);
  let after: ListPosition | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    if (search !== undefined && decoded.sort === undefined) return { kind: 'invalid_cursor' };
    after = { id: decoded.after, sort: decoded.sort };
  }

  // Row-level security scopes the rows, but the planner estimates its
  // `current_setting` as an average tenant and walks the primary key across all
  // of them; naming the tenant uses its own statistics.
  const conditions = [
    eq(clients.tenantId, input.tenantId),
    ...(await clientListConditions(tx, input.filters, after)),
  ];
  const where = and(...conditions);
  const order = clientListOrder(input.filters);
  const viewOf = () =>
    tx
      .select({ view: CLIENT_VIEW_COLUMNS, searchKey: search?.column ?? sql<null>`null` })
      .from(clients)
      .innerJoin(clientOidcConfig, eq(clients.id, clientOidcConfig.clientId));
  // A search reads its page of keys from the search index alone, then the rows
  // by id: the planner prices a bitmap of every match against an ordered scan,
  // and the keys cost nothing it can get wrong.
  let rows: Awaited<ReturnType<typeof viewOf>>;
  if (search === undefined) {
    rows = await viewOf()
      .where(where)
      .orderBy(...order)
      .limit(input.limit + 1);
  } else {
    rows = await readKeyedPage(
      async () =>
        (
          await tx
            .select({ id: clients.id })
            .from(clients)
            .where(where)
            .orderBy(...order)
            .limit(input.limit + 1)
        ).map((row) => row.id),
      (ids) => viewOf().where(inArray(clients.id, [...ids])),
      (row) => row.view.id,
    );
  }

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const items = await attachScopesMany(
    tx,
    page.map((row) => narrowRow(row.view)),
  );
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.view.id,
          ...(search === undefined ? {} : { sort: requireSearchKey(last.searchKey) }),
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
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
  return row === undefined
    ? { kind: 'not_found' }
    : { kind: 'ok', client: await attachScopes(tx, narrowRow(row)) };
}

export interface CreateClientInput {
  readonly clientId: string;
  // The body as the caller sent it, minus `client_id` (which this door lets
  // an operator choose and dynamic registration does not): RFC 7591
  // metadata narrowed by `parseClientMetadata`, plus the admin-only fields
  // `checkedAdminFields` narrows.
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
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
      field?: string;
    }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
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

function toClientView(client: ClientRecord, config: ClientOidcConfig): StoredView {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    description: client.description,
    enabled: client.enabled,
    type: client.type,
    createdAt: client.createdAt,
    fullScopeAllowed: client.fullScopeAllowed,
    registrationOrigin: client.registrationOrigin,
    builtinAdmin: client.builtinAdmin,
    serviceSubjectId: client.serviceSubjectId,
    redirectUris: config.redirectUris,
    grantTypes: config.grantTypes,
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
    audiences: config.audiences,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    idTokenTtlSeconds: config.idTokenTtlSeconds,
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
    clientUri: config.clientUri,
    policyUri: config.policyUri,
    tosUri: config.tosUri,
    idTokenSignedResponseAlg: config.idTokenSignedResponseAlg,
    defaultMaxAge: config.defaultMaxAge,
    requireAuthTime: config.requireAuthTime,
    previousSecretExpiresAt: client.previousSecretExpiresAt,
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
    await deps.audit(tx, {
      action: 'client.create',
      resourceType: 'client',
      resourceId: input.clientId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
    });
    return { kind: 'reserved_client_id' };
  }

  const parsed = parseClientMetadata(input.metadata, {
    tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
  });
  if (parsed.kind === 'invalid') {
    await deps.audit(tx, {
      action: 'client.create',
      resourceType: 'client',
      resourceId: input.clientId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { error: parsed.error },
    });
    return {
      kind: 'invalid_metadata',
      error: parsed.error,
      description: parsed.description,
      ...(parsed.field === undefined ? {} : { field: parsed.field }),
    };
  }
  const metadata = parsed.metadata;
  const type = clientType(metadata.tokenEndpointAuthMethod);
  const unavailable = await idTokenAlgUnavailable(tx, metadata.idTokenSignedResponseAlg);
  if (unavailable !== null) {
    await deps.audit(tx, {
      action: 'client.create',
      resourceType: 'client',
      resourceId: input.clientId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
    });
    return {
      kind: 'invalid_value',
      field: 'id_token_signed_response_alg',
      description: unavailable,
    };
  }

  const auditRefusal = (): Promise<void> =>
    deps.audit(tx, {
      action: 'client.create',
      resourceType: 'client',
      resourceId: input.clientId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
    });
  const refusal = createFieldRefusal(input.metadata);
  if (refusal !== null) {
    await auditRefusal();
    return { kind: 'refused_field', ...refusal };
  }
  const admin = checkedAdminFields(input.metadata);
  if (isFieldError(admin)) {
    await auditRefusal();
    return { kind: 'invalid_value', ...admin };
  }

  // Locked and counted the same way `registerClient` gates dynamic
  // registration (`packages/protocol-oidc/src/usecase/client-registration.ts`)
  // — the holder of `manage-clients` is not the holder of `manage-tenant`,
  // which is what sets `max_clients`, so this door needs its own check
  // rather than trusting the two capabilities to be held together.
  const capacity = await clientRepository(tx).lockCapacity(input.tenantId);
  if (capacity.count >= capacity.maxClients) {
    await deps.audit(tx, {
      action: 'client.create',
      resourceType: 'client',
      resourceId: input.clientId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
    });
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
    name: admin.client.name ?? metadata.clientName ?? input.clientId,
    type,
    secretHash,
    serviceSubjectId,
    ...(admin.client.description === undefined ? {} : { description: admin.client.description }),
    ...(admin.client.enabled === undefined ? {} : { enabled: admin.client.enabled }),
    ...(admin.client.fullScopeAllowed === undefined
      ? {}
      : { fullScopeAllowed: admin.client.fullScopeAllowed }),
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
    accessTokenTtlSeconds: null,
    refreshTokenTtlSeconds: null,
    ...admin.config,
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
    clientUri: metadata.clientUri,
    policyUri: metadata.policyUri,
    tosUri: metadata.tosUri,
    idTokenSignedResponseAlg: metadata.idTokenSignedResponseAlg,
    defaultMaxAge: metadata.defaultMaxAge,
    requireAuthTime: metadata.requireAuthTime,
  });

  const view = await attachScopes(tx, toClientView(client, config));

  await deps.audit(tx, {
    action: 'client.create',
    resourceType: 'client',
    resourceId: client.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('client', null, clientWireShape(view)),
  });

  return { kind: 'ok', client: view, secret };
}

// The wire shape a caller reads back, and what an `ETag` is hashed over —
// the same mapping on a `GET` (view/routes/clients.ts's `toWireClient`
// delegates here) and on the read `amendClient` does before writing, so an
// `If-Match` taken from one always compares against the other.
export function clientWireShape(view: ClientView): ClientFields {
  return {
    id: view.id,
    client_id: view.clientId,
    name: view.name,
    description: view.description,
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
    id_token_ttl_seconds: view.idTokenTtlSeconds,
    refresh_token_ttl_seconds: view.refreshTokenTtlSeconds,
    client_credentials_scopes: view.clientCredentialsScopes,
    web_origins: view.webOrigins,
    post_logout_redirect_uris: view.postLogoutRedirectUris,
    jwks: publicJwks(view.jwks).value,
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
    client_uri: view.clientUri,
    policy_uri: view.policyUri,
    tos_uri: view.tosUri,
    id_token_signed_response_alg: view.idTokenSignedResponseAlg,
    default_max_age: view.defaultMaxAge,
    require_auth_time: view.requireAuthTime,
    previous_secret_expires_at: view.previousSecretExpiresAt?.toISOString() ?? null,
    builtin_admin: view.builtinAdmin,
    service_subject_id: view.serviceSubjectId,
    scopes: view.scopes.map((scope) => ({
      id: scope.id,
      name: scope.name,
      assignment: scope.assignment,
    })),
  };
}

/** The answer a caller reads: the stored shape and what the service account holds. */
export function clientWire(view: ClientView): Client {
  return {
    ...clientWireShape(view),
    service_account_admin_reach: [...view.serviceAccountAdminReach],
  };
}

export interface AmendClientInput extends ClientCeilingCaller {
  readonly clientDbId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
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
      field?: string;
    }
  | { kind: 'precondition_required'; field: string }
  | { kind: 'precondition_failed' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | { kind: 'auth_method_changes_type'; reason: string }
  | TargetCeilingRefusal
  | { kind: 'ok'; client: ClientView; etag: string };

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
  'client_uri',
  'policy_uri',
  'tos_uri',
  'id_token_signed_response_alg',
  'default_max_age',
  'require_auth_time',
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
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return { field, description: `${field} must be an array of strings` };
  }
  return value.length > CLIENT_LIST_LIMIT
    ? {
        field,
        description: listLimitMessage(value.length),
      }
    : value;
}

function checkedDescription(value: unknown): string | null | FieldError {
  const checked = checkDescription(value);
  return checked.kind === 'ok'
    ? checked.value
    : { field: 'description', description: checked.message };
}

function checkedWebOrigins(origins: readonly string[]): string[] | FieldError {
  const bad = origins.find((origin) => !isWellFormedWebOrigin(origin));
  return bad === undefined
    ? [...origins]
    : {
        field: 'web_origins',
        description: `web_origins entry ${JSON.stringify(bad)} is not an origin: expected a scheme and host with no path, or "+" for every registered redirect URI's origin`,
      };
}

// The amendable fields that are this server's own configuration rather
// than RFC 7591 metadata — checked the same way whether a client is being
// created or amended, since none of the checks depends on a stored row.
const ADMIN_FIELDS = new Set<string>([
  'name',
  'description',
  'enabled',
  'full_scope_allowed',
  'audiences',
  'web_origins',
  'post_logout_redirect_uris',
  'client_credentials_scopes',
  'access_token_ttl_seconds',
  'id_token_ttl_seconds',
  'refresh_token_ttl_seconds',
  'consent_required',
  'token_exchange_impersonation_allowed',
]);

interface AdminFieldPatches {
  readonly client: {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    fullScopeAllowed?: boolean;
  };
  readonly config: {
    audiences?: string[];
    webOrigins?: string[];
    postLogoutRedirectUris?: string[];
    clientCredentialsScopes?: string[];
    accessTokenTtlSeconds?: number | null;
    idTokenTtlSeconds?: number | null;
    refreshTokenTtlSeconds?: number | null;
    consentRequired?: boolean;
    tokenExchangeImpersonationAllowed?: boolean;
  };
}

const TOKEN_TTL_FIELDS = [
  'access_token_ttl_seconds',
  'id_token_ttl_seconds',
  'refresh_token_ttl_seconds',
] as const;

function checkedAdminFields(
  values: Readonly<Record<string, unknown>>,
): AdminFieldPatches | FieldError {
  const client: AdminFieldPatches['client'] = {};
  const config: AdminFieldPatches['config'] = {};

  if ('name' in values) {
    const checked = checkedString('name', values.name);
    if (isFieldError(checked)) return checked;
    client.name = checked;
  }
  if ('description' in values) {
    const checked = checkedDescription(values.description);
    if (isFieldError(checked)) return checked;
    client.description = checked;
  }
  if ('enabled' in values) {
    const checked = checkedBoolean('enabled', values.enabled);
    if (isFieldError(checked)) return checked;
    client.enabled = checked;
  }
  if ('full_scope_allowed' in values) {
    const checked = checkedBoolean('full_scope_allowed', values.full_scope_allowed);
    if (isFieldError(checked)) return checked;
    client.fullScopeAllowed = checked;
  }

  for (const field of [
    'audiences',
    'web_origins',
    'post_logout_redirect_uris',
    'client_credentials_scopes',
  ] as const) {
    if (!(field in values)) continue;
    const checked = checkedStringArray(field, values[field]);
    if (isFieldError(checked)) return checked;
    if (field === 'audiences') config.audiences = checked;
    else if (field === 'web_origins') {
      const origins = checkedWebOrigins(checked);
      if (isFieldError(origins)) return origins;
      config.webOrigins = origins;
    } else if (field === 'post_logout_redirect_uris') config.postLogoutRedirectUris = checked;
    else config.clientCredentialsScopes = checked;
  }
  // Null hands the lifetime back to the tenant's setting of the same name.
  for (const field of TOKEN_TTL_FIELDS) {
    if (!(field in values)) continue;
    let lifetime: number | null = null;
    if (values[field] !== null) {
      const checked = checkedInteger(field, values[field]);
      if (isFieldError(checked)) return checked;
      const outOfRange = clientTokenTtlProblem(field, checked);
      if (outOfRange !== null) return { field, description: outOfRange };
      lifetime = checked;
    }
    if (field === 'access_token_ttl_seconds') config.accessTokenTtlSeconds = lifetime;
    else if (field === 'id_token_ttl_seconds') config.idTokenTtlSeconds = lifetime;
    else config.refreshTokenTtlSeconds = lifetime;
  }
  for (const field of ['consent_required', 'token_exchange_impersonation_allowed'] as const) {
    if (!(field in values)) continue;
    const checked = checkedBoolean(field, values[field]);
    if (isFieldError(checked)) return checked;
    if (field === 'consent_required') config.consentRequired = checked;
    else config.tokenExchangeImpersonationAllowed = checked;
  }

  return { client, config };
}

// Every key a create body may carry is either RFC 7591 metadata or a field
// `amendClient` would accept; anything else is refused by name rather than
// dropped, so a create can never quietly differ from what was asked for.
function createFieldRefusal(
  body: Readonly<Record<string, unknown>>,
): { field: string; reason: string } | null {
  for (const field of Object.keys(body)) {
    if (field === 'client_name' || METADATA_FIELDS.has(field) || ADMIN_FIELDS.has(field)) continue;
    return { field, reason: refusalFor(field) ?? `${field} is not a client field` };
  }
  if ('name' in body && 'client_name' in body && body.name !== body.client_name) {
    return { field: 'name', reason: 'name and client_name disagree; send one of them' };
  }
  return null;
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
  const unlocked = await clientRepository(tx).byId(input.clientDbId);
  if (unlocked === null) return { kind: 'not_found' };
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'client.amend',
    unlocked.serviceSubjectId,
    input,
    { type: 'client', id: input.clientDbId },
  );
  if (refused !== null) return refused;

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
    const guarded = Object.keys(input.values).find(
      (field) => !BUILTIN_ADMIN_AMENDABLE_FIELDS.includes(field),
    );
    const reason =
      input.values.enabled === false
        ? `${clientRow.clientId} is this tenant's built-in admin client and cannot be disabled`
        : guarded === undefined
          ? null
          : `${guarded} on ${clientRow.clientId}, this tenant's built-in admin client, is not amendable: it could leave every administrator of this tenant locked out`;
    if (reason !== null) {
      await deps.audit(tx, {
        action: 'client.amend',
        resourceType: 'client',
        resourceId: input.clientDbId,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'refused',
        detail: { reason },
      });
      return { kind: 'builtin_admin_guarded', reason };
    }
  }

  const configRow = await clientOidcConfigRepository(tx).byClientId(input.clientDbId);
  if (configRow === null) {
    throw new Error(`client ${input.clientDbId} has no client_oidc_config row`);
  }

  const admin = checkedAdminFields(input.values);
  if (isFieldError(admin)) return { kind: 'invalid_value', ...admin };
  const clientPatch = admin.client;
  const configPatch: Partial<Omit<typeof clientOidcConfig.$inferInsert, 'clientId' | 'tenantId'>> =
    { ...admin.config };

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
      jwks: metadataFieldValue(input.values, 'jwks', publicJwks(configRow.jwks).value),
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
      client_uri: metadataFieldValue(input.values, 'client_uri', configRow.clientUri),
      policy_uri: metadataFieldValue(input.values, 'policy_uri', configRow.policyUri),
      tos_uri: metadataFieldValue(input.values, 'tos_uri', configRow.tosUri),
      id_token_signed_response_alg: metadataFieldValue(
        input.values,
        'id_token_signed_response_alg',
        configRow.idTokenSignedResponseAlg,
      ),
      default_max_age: metadataFieldValue(input.values, 'default_max_age', configRow.defaultMaxAge),
      require_auth_time: metadataFieldValue(
        input.values,
        'require_auth_time',
        configRow.requireAuthTime,
      ),
    };

    const parsed = parseClientMetadata(merged, {
      tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
      // A list stored before the bound existed is left as it is until a
      // write changes it, which must then bring it under.
      boundRedirectUris: 'redirect_uris' in input.values,
    });
    if (parsed.kind === 'invalid') {
      return {
        kind: 'invalid_metadata',
        error: parsed.error,
        description: parsed.description,
        ...(parsed.field === undefined ? {} : { field: parsed.field }),
      };
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
    configPatch.clientUri = parsed.metadata.clientUri;
    configPatch.policyUri = parsed.metadata.policyUri;
    configPatch.tosUri = parsed.metadata.tosUri;
    configPatch.idTokenSignedResponseAlg = parsed.metadata.idTokenSignedResponseAlg;
    configPatch.defaultMaxAge = parsed.metadata.defaultMaxAge;
    configPatch.requireAuthTime = parsed.metadata.requireAuthTime;
    if ('id_token_signed_response_alg' in input.values) {
      const unavailable = await idTokenAlgUnavailable(tx, parsed.metadata.idTokenSignedResponseAlg);
      if (unavailable !== null) {
        return {
          kind: 'invalid_value',
          field: 'id_token_signed_response_alg',
          description: unavailable,
        };
      }
    }

    // `type` is unamendable (`refusalFor('type')`) for exactly this reason;
    // reaching the same change through `token_endpoint_auth_method` instead
    // would otherwise leave the client's row and its authentication method
    // disagreeing about which side of the boundary it is on — a public
    // client with a `client_secret_basic` config, or a confidential one
    // `verifyClientSecret` (@odudu/domain-tenant) now rejects every secret
    // for.
    if ('token_endpoint_auth_method' in input.values) {
      const impliedType = clientType(parsed.metadata.tokenEndpointAuthMethod);
      if (impliedType !== clientRow.type) {
        return {
          kind: 'auth_method_changes_type',
          reason: `${clientRow.clientId} is ${clientRow.type}; token_endpoint_auth_method ${parsed.metadata.tokenEndpointAuthMethod} implies ${impliedType} and would change its security model`,
        };
      }
    }
  }

  const requiredIfMatchField = WHOLESALE_LIST_FIELDS.find((field) => field in input.values);
  if (requiredIfMatchField !== undefined && input.ifMatch === undefined) {
    return { kind: 'precondition_required', field: requiredIfMatchField };
  }

  const currentView = await attachScopes(tx, toClientView(clientRow, configRow));
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

  const view = await attachScopes(tx, toClientView(updatedClientRow, updatedConfigRow));

  await deps.audit(tx, {
    action: 'client.amend',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('client', clientWireShape(currentView), clientWireShape(view)),
  });

  return { kind: 'ok', client: view, etag: etagOf(clientWireShape(view)) };
}

export interface RotateClientSecretInput extends ClientCeilingCaller {
  readonly clientDbId: string;
  /** How long the replaced secret keeps authenticating; zero ends it now. */
  readonly graceSeconds: number;
}

export interface RotateClientSecretDeps {
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly audit: Audit;
  readonly now: () => Date;
}

export type RotateClientSecretOutcome =
  | { kind: 'not_found' }
  | { kind: 'not_confidential' }
  | TargetCeilingRefusal
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
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'client.rotate_secret',
    clientRow.serviceSubjectId,
    input,
    { type: 'client', id: input.clientDbId },
  );
  if (refused !== null) return refused;

  const secret = generateClientSecret();
  const secretHash = await deps.hashClientSecret(secret);
  const previousExpiresAt =
    input.graceSeconds > 0 && clientRow.secretHash !== null
      ? new Date(deps.now().getTime() + input.graceSeconds * 1000)
      : null;
  const updatedClientRow = await clientRepository(tx).rotateSecret(
    input.clientDbId,
    secretHash,
    previousExpiresAt === null || clientRow.secretHash === null
      ? null
      : { hash: clientRow.secretHash, expiresAt: previousExpiresAt },
  );

  await deps.audit(tx, {
    action: 'client.rotate_secret',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    // Named rather than diffed: secretHash never appears in a wire shape
    // for redactedDiff to read, so this states the facts worth recording
    // without ever holding a hash, old or new.
    detail: {
      secret_hash: { changed: true },
      grace_seconds: input.graceSeconds,
      previous_secret_expires_at: previousExpiresAt?.toISOString() ?? null,
    },
  });

  const configRow = await clientOidcConfigRepository(tx).byClientId(input.clientDbId);
  if (configRow === null) {
    throw new Error(`client ${input.clientDbId} has no client_oidc_config row`);
  }
  return {
    kind: 'ok',
    client: await attachScopes(tx, toClientView(updatedClientRow, configRow)),
    secret,
  };
}

export interface DeleteClientInput extends ClientCeilingCaller {
  readonly clientDbId: string;
}

export interface DeleteClientDeps {
  readonly audit: Audit;
}

export type DeleteClientOutcome =
  | { kind: 'not_found' }
  | { kind: 'builtin_admin_guarded'; reason: string }
  | TargetCeilingRefusal
  | { kind: 'capability_ceiling'; requested: readonly string[]; removed?: readonly string[] }
  | { kind: 'deleted' }
  | LastAdministratorRefusal;

export async function deleteClient(
  tx: TenantScopedDatabase,
  deps: DeleteClientDeps,
  input: DeleteClientInput,
): Promise<DeleteClientOutcome> {
  return guardLastAdministrator(
    tx,
    {
      action: 'client.delete',
      resourceType: 'client',
      resourceId: input.clientDbId,
      actor: input,
      audit: deps.audit,
    },
    (inner) => deleteClientUnguarded(inner, deps, input),
  );
}

async function deleteClientUnguarded(
  tx: TenantScopedDatabase,
  deps: DeleteClientDeps,
  input: DeleteClientInput,
): Promise<DeleteClientOutcome> {
  const clientRow = await clientRepository(tx).byId(input.clientDbId);
  if (clientRow === null) return { kind: 'not_found' };
  const refused = await refuseOverServiceAccountCeiling(
    tx,
    deps.audit,
    'client.delete',
    clientRow.serviceSubjectId,
    input,
    { type: 'client', id: input.clientDbId },
  );
  if (refused !== null) return refused;
  if (clientRow.builtinAdmin) {
    const reason = `${clientRow.clientId} is this tenant's built-in admin client and cannot be deleted`;
    await deps.audit(tx, {
      action: 'client.delete',
      resourceType: 'client',
      resourceId: input.clientDbId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'builtin_admin_guarded', reason };
  }

  // `roles_client_fk` cascades, so the delete takes every role scoped to the
  // client, and every grant and composite edge naming one, with it.
  const scopedRoles = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.clientId, input.clientDbId));
  const denied = overreach(
    await capabilitiesReachableFrom(
      tx,
      scopedRoles.map((role) => role.id),
    ),
    input.callerCapabilities,
  );
  if (denied.length > 0) {
    await deps.audit(tx, {
      action: 'client.delete',
      resourceType: 'client',
      resourceId: input.clientDbId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { denied },
    });
    return { kind: 'capability_ceiling', requested: [], removed: denied };
  }

  await clientRepository(tx).delete(input.clientDbId);

  await deps.audit(tx, {
    action: 'client.delete',
    resourceType: 'client',
    resourceId: input.clientDbId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'deleted' };
}
