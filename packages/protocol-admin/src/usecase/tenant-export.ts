import { authenticationExecutions, userRequiredActions } from '@odudu/authn-flows';
import {
  EXPORT_SUBJECT_CAP,
  profileSchema,
  REGISTRATION_POLICY_SETTINGS,
  registrationPolicySchema,
  tenantSettingsDocumentSchema,
  type ExportedClient,
  type ExportedGroup,
  type ExportedRole,
  type ExportedScope,
  type ExportedSmtp,
  type ExportedSubject,
  type RoleReference,
  type TenantDocument,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  clientScopeRoles,
  groupRoles,
  groups,
  roleComposites,
  roles,
  subjectGroups,
  subjectRoles,
} from '@odudu/domain-authz';
import { subjects, userCredentials, users } from '@odudu/domain-identity';
import {
  clients,
  clientScopeAssignments,
  clientScopeMappers,
  clientScopes,
  TENANT_DEFAULT_SCOPE_NAMES,
  tenantSettingsRepository,
  type ClientRecord,
  type ClientScopeAssignment,
} from '@odudu/domain-tenant';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { tenantSmtpRepository, type TenantSmtpRecord } from '#/repository/tenant-smtp';
import { publicJwks } from '#/service/public-jwks';
import { profileWireShape } from '#/usecase/profile';

export interface TenantExportAuditEvent {
  readonly action: 'tenant.export';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: { readonly include_subjects: boolean };
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: TenantExportAuditEvent) => Promise<void>;

export interface ExportTenantInput {
  readonly tenantId: string;
  readonly includeSubjects: boolean;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface ExportTenantDeps {
  readonly audit: Audit;
}

export type ExportTenantOutcome =
  | { readonly kind: 'exported'; readonly document: TenantDocument }
  | { readonly kind: 'too_many_subjects'; readonly cap: number };

// Byte order, not locale order, so the same tenant always exports the same
// bytes whatever the server's locale — a document is diffed as often as it
// is imported.
function byKey<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function roleKey(reference: RoleReference): string {
  return `${reference.client ?? ''}\u0000${reference.name}`;
}

const sortRoleReferences = byKey(roleKey);

// Not strict, so parsing drops `profile_updated_at`: the claim is stamped
// by the write that changes a profile, never carried from one tenant to another.
const exportedProfileSchema = profileSchema.omit({ profile_updated_at: true });

interface RoleRow {
  readonly id: string;
  readonly reference: RoleReference;
  readonly description: string | null;
  readonly defaultForNewSubjects: boolean;
  readonly builtin: boolean;
}

// Counted one row past the cap and no further, as `usecase/counts.ts`
// counts: a tenant far above it costs no more to refuse than one just over.
async function exportableSubjectCount(
  tx: TenantScopedDatabase,
  tenantId: string,
  cap: number,
): Promise<number> {
  const bounded = tx
    .select({ one: sql<number>`1`.as('one') })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .limit(cap + 1)
    .as('bounded');
  const rows = await tx.select({ n: count() }).from(bounded);
  return rows[0]?.n ?? 0;
}

async function readRoles(tx: TenantScopedDatabase, tenantId: string): Promise<RoleRow[]> {
  const rows = await tx
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      defaultForNewSubjects: roles.defaultForNewSubjects,
      clientKey: clients.clientId,
      builtinAdmin: clients.builtinAdmin,
    })
    .from(roles)
    .leftJoin(clients, eq(roles.clientId, clients.id))
    .where(eq(roles.tenantId, tenantId));
  return rows.map((row) => ({
    id: row.id,
    reference: { name: row.name, client: row.clientKey },
    description: row.description,
    defaultForNewSubjects: row.defaultForNewSubjects,
    builtin: row.builtinAdmin === true,
  }));
}

// Pairs of (owner row id, role row id), resolved to references by name and
// grouped by owner.
function referencesByOwner(
  pairs: readonly { readonly owner: string; readonly roleId: string }[],
  roleById: ReadonlyMap<string, RoleRow>,
): Map<string, RoleReference[]> {
  const map = new Map<string, RoleReference[]>();
  for (const { owner, roleId } of pairs) {
    const role = roleById.get(roleId);
    if (role !== undefined) push(map, owner, role.reference);
  }
  for (const list of map.values()) list.sort(sortRoleReferences);
  return map;
}

async function subjectRoleReferences(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectIds: readonly string[],
  roleById: ReadonlyMap<string, RoleRow>,
): Promise<Map<string, RoleReference[]>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await tx
    .select({ owner: subjectRoles.subjectId, roleId: subjectRoles.roleId })
    .from(subjectRoles)
    .where(
      and(eq(subjectRoles.tenantId, tenantId), inArray(subjectRoles.subjectId, [...subjectIds])),
    );
  return referencesByOwner(rows, roleById);
}

/** Why a tenant's subjects are too many to move in one document, export and import alike. */
export function tooManySubjectsDetail(cap: number): string {
  return (
    `the tenant holds more than ${String(cap)} subjects, too many to export ` +
    'with ?include=subjects; export without it, and move users in bulk through ' +
    'inbound provisioning (P7)'
  );
}

interface ClientRow {
  readonly id: string;
  readonly serviceSubjectId: string | null;
  readonly strippedKeys: readonly number[];
  readonly exported: Omit<ExportedClient, 'service_account_roles'>;
}

async function readClients(tx: TenantScopedDatabase, tenantId: string): Promise<ClientRow[]> {
  const rows = await tx
    .select({
      id: clients.id,
      serviceSubjectId: clients.serviceSubjectId,
      clientId: clients.clientId,
      name: clients.name,
      type: clients.type,
      enabled: clients.enabled,
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
    })
    .from(clients)
    .innerJoin(clientOidcConfig, eq(clients.id, clientOidcConfig.clientId))
    .where(and(eq(clients.tenantId, tenantId), eq(clients.builtinAdmin, false)));
  return rows.sort(byKey((row) => row.clientId)).map((row) => {
    const jwks = publicJwks(row.jwks);
    return {
      id: row.id,
      serviceSubjectId: row.serviceSubjectId,
      strippedKeys: jwks.strippedKeys,
      exported: {
        client_id: row.clientId,
        name: row.name,
        // Plain text columns bounded by CHECKs (clients_secret_matches_type,
        // clients_registration_origin_check), narrowed as `clientRepository` does.
        type: row.type as ClientRecord['type'],
        enabled: row.enabled,
        full_scope_allowed: row.fullScopeAllowed,
        registration_origin: row.registrationOrigin as ClientRecord['registrationOrigin'],
        redirect_uris: row.redirectUris,
        grant_types: row.grantTypes,
        token_endpoint_auth_method: row.tokenEndpointAuthMethod,
        audiences: row.audiences,
        access_token_ttl_seconds: row.accessTokenTtlSeconds,
        refresh_token_ttl_seconds: row.refreshTokenTtlSeconds,
        client_credentials_scopes: row.clientCredentialsScopes,
        web_origins: row.webOrigins,
        post_logout_redirect_uris: row.postLogoutRedirectUris,
        jwks: jwks.value,
        jwks_uri: row.jwksUri,
        frontchannel_logout_uri: row.frontchannelLogoutUri,
        backchannel_logout_uri: row.backchannelLogoutUri,
        frontchannel_logout_session_required: row.frontchannelLogoutSessionRequired,
        backchannel_logout_session_required: row.backchannelLogoutSessionRequired,
        consent_required: row.consentRequired,
        token_exchange_impersonation_allowed: row.tokenExchangeImpersonationAllowed,
        userinfo_signed_response_alg: row.userinfoSignedResponseAlg,
        userinfo_encrypted_response_alg: row.userinfoEncryptedResponseAlg,
        userinfo_encrypted_response_enc: row.userinfoEncryptedResponseEnc,
        tls_client_auth_subject_dn: row.tlsClientAuthSubjectDn,
      },
    };
  });
}

async function exportRoles(
  tx: TenantScopedDatabase,
  tenantId: string,
  roleRows: readonly RoleRow[],
  roleById: ReadonlyMap<string, RoleRow>,
): Promise<ExportedRole[]> {
  const edges = await tx
    .select({ owner: roleComposites.parentRoleId, roleId: roleComposites.childRoleId })
    .from(roleComposites)
    .where(eq(roleComposites.tenantId, tenantId));
  const composites = referencesByOwner(edges, roleById);
  return [...roleRows].sort(byKey((role) => roleKey(role.reference))).map((role) => ({
    name: role.reference.name,
    client: role.reference.client,
    description: role.description,
    default_for_new_subjects: role.defaultForNewSubjects,
    builtin: role.builtin,
    composites: composites.get(role.id) ?? [],
  }));
}

async function exportGroups(
  tx: TenantScopedDatabase,
  tenantId: string,
  roleById: ReadonlyMap<string, RoleRow>,
): Promise<{ groups: ExportedGroup[]; pathById: Map<string, string> }> {
  const rows = await tx
    .select({ id: groups.id, path: groups.path })
    .from(groups)
    .where(eq(groups.tenantId, tenantId));
  const mapped = await tx
    .select({ owner: groupRoles.groupId, roleId: groupRoles.roleId })
    .from(groupRoles)
    .where(eq(groupRoles.tenantId, tenantId));
  const rolesByGroup = referencesByOwner(mapped, roleById);
  return {
    groups: [...rows]
      .sort(byKey((row) => row.path))
      .map((row) => ({ path: row.path, roles: rolesByGroup.get(row.id) ?? [] })),
    pathById: new Map(rows.map((row) => [row.id, row.path])),
  };
}

async function exportScopes(
  tx: TenantScopedDatabase,
  tenantId: string,
  roleById: ReadonlyMap<string, RoleRow>,
): Promise<ExportedScope[]> {
  const rows = await tx
    .select({
      id: clientScopes.id,
      name: clientScopes.name,
      description: clientScopes.description,
      includeInIdToken: clientScopes.includeInIdToken,
      includeInAccessToken: clientScopes.includeInAccessToken,
    })
    .from(clientScopes)
    .where(eq(clientScopes.tenantId, tenantId));
  const mapped = await tx
    .select({ owner: clientScopeRoles.clientScopeId, roleId: clientScopeRoles.roleId })
    .from(clientScopeRoles)
    .where(eq(clientScopeRoles.tenantId, tenantId));
  const rolesByScope = referencesByOwner(mapped, roleById);

  const bindings = await tx
    .select({ scopeId: clientScopeMappers.clientScopeId, name: clientScopeMappers.mapperName })
    .from(clientScopeMappers)
    .where(eq(clientScopeMappers.tenantId, tenantId));
  const mappersByScope = new Map<string, string[]>();
  for (const binding of bindings) push(mappersByScope, binding.scopeId, binding.name);

  // The built-in admin client is provisioned by every new tenant with its
  // own assignments, so an assignment to it is not part of the document.
  const assigned = await tx
    .select({
      scopeId: clientScopeAssignments.clientScopeId,
      clientId: clients.clientId,
      assignment: clientScopeAssignments.assignment,
    })
    .from(clientScopeAssignments)
    .innerJoin(clients, eq(clientScopeAssignments.clientId, clients.id))
    .where(and(eq(clientScopeAssignments.tenantId, tenantId), eq(clients.builtinAdmin, false)));
  const clientsByScope = new Map<
    string,
    { client_id: string; assignment: ClientScopeAssignment }[]
  >();
  for (const row of assigned) {
    push(clientsByScope, row.scopeId, { client_id: row.clientId, assignment: row.assignment });
  }

  const builtinNames = new Set(TENANT_DEFAULT_SCOPE_NAMES);
  return rows.sort(byKey((row) => row.name)).map((row) => ({
    name: row.name,
    description: row.description,
    include_in_id_token: row.includeInIdToken,
    include_in_access_token: row.includeInAccessToken,
    builtin: builtinNames.has(row.name),
    roles: rolesByScope.get(row.id) ?? [],
    mappers: [...(mappersByScope.get(row.id) ?? [])].sort(),
    clients: [...(clientsByScope.get(row.id) ?? [])].sort(byKey((c) => c.client_id)),
  }));
}

async function exportSubjects(
  tx: TenantScopedDatabase,
  tenantId: string,
  roleById: ReadonlyMap<string, RoleRow>,
  groupPathById: ReadonlyMap<string, string>,
): Promise<{ subjects: ExportedSubject[]; credentialed: readonly number[] }> {
  const rows = await tx
    .select({
      subjectId: users.subjectId,
      tenantId: users.tenantId,
      disabledAt: subjects.disabledAt,
      username: users.username,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      givenName: users.givenName,
      familyName: users.familyName,
      middleName: users.middleName,
      nickname: users.nickname,
      preferredUsername: users.preferredUsername,
      profile: users.profile,
      picture: users.picture,
      website: users.website,
      gender: users.gender,
      birthdate: users.birthdate,
      zoneinfo: users.zoneinfo,
      locale: users.locale,
      phoneNumber: users.phoneNumber,
      phoneNumberVerified: users.phoneNumberVerified,
      profileUpdatedAt: users.profileUpdatedAt,
      addressFormatted: users.addressFormatted,
      addressStreet: users.addressStreet,
      addressLocality: users.addressLocality,
      addressRegion: users.addressRegion,
      addressPostalCode: users.addressPostalCode,
      addressCountry: users.addressCountry,
    })
    .from(users)
    .innerJoin(subjects, eq(users.subjectId, subjects.id))
    .where(eq(users.tenantId, tenantId));
  rows.sort(byKey((row) => row.username));
  const ids = rows.map((row) => row.subjectId);

  const rolesBySubject = await subjectRoleReferences(tx, tenantId, ids, roleById);
  const memberships = await tx
    .select({ subjectId: subjectGroups.subjectId, groupId: subjectGroups.groupId })
    .from(subjectGroups)
    .where(eq(subjectGroups.tenantId, tenantId));
  const groupsBySubject = new Map<string, string[]>();
  for (const { subjectId, groupId } of memberships) {
    const path = groupPathById.get(groupId);
    if (path !== undefined) push(groupsBySubject, subjectId, path);
  }
  const pending = await tx
    .select({ subjectId: userRequiredActions.subjectId, action: userRequiredActions.action })
    .from(userRequiredActions)
    .where(eq(userRequiredActions.tenantId, tenantId));
  const actionsBySubject = new Map<string, ExportedSubject['required_actions']>();
  for (const { subjectId, action } of pending) push(actionsBySubject, subjectId, action);
  const holders = await tx
    .selectDistinct({ subjectId: userCredentials.subjectId })
    .from(userCredentials)
    .where(eq(userCredentials.tenantId, tenantId));
  const withCredentials = new Set(holders.map((row) => row.subjectId));

  return {
    credentialed: rows.flatMap((row, index) => (withCredentials.has(row.subjectId) ? [index] : [])),
    subjects: rows.map((row) => ({
      username: row.username,
      email: row.email,
      enabled: row.disabledAt === null,
      profile: exportedProfileSchema.parse(profileWireShape(row)),
      roles: rolesBySubject.get(row.subjectId) ?? [],
      groups: [...(groupsBySubject.get(row.subjectId) ?? [])].sort(),
      required_actions: [...(actionsBySubject.get(row.subjectId) ?? [])].sort(),
    })),
  };
}

function exportSmtp(record: TenantSmtpRecord | null): ExportedSmtp | null {
  if (record === null) return null;
  return {
    host: record.host,
    port: record.port,
    from_address: record.fromAddress,
    username: record.username,
    starttls: record.starttls,
  };
}

/**
 * The tenant's configuration as a document another tenant can be created
 * from, with every reference by name and no secret in it: each secret a
 * reader would expect is named under `omitted` instead. Subjects only on
 * request, and refused above `EXPORT_SUBJECT_CAP`.
 */
export async function exportTenant(
  tx: TenantScopedDatabase,
  deps: ExportTenantDeps,
  input: ExportTenantInput,
  options: { readonly subjectCap?: number } = {},
): Promise<ExportTenantOutcome> {
  const { tenantId } = input;
  const cap = options.subjectCap ?? EXPORT_SUBJECT_CAP;
  if (input.includeSubjects && (await exportableSubjectCount(tx, tenantId, cap)) > cap) {
    return { kind: 'too_many_subjects', cap };
  }

  const record = await tenantSettingsRepository(tx).byId(tenantId);
  if (record === null) throw new Error(`tenant ${tenantId} has no settings row`);
  const policyNames = new Set(REGISTRATION_POLICY_SETTINGS);
  const settings = tenantSettingsDocumentSchema.parse(
    Object.fromEntries(Object.entries(record).filter(([name]) => !policyNames.has(name))),
  );
  const registrationPolicy = registrationPolicySchema.parse(
    Object.fromEntries(Object.entries(record).filter(([name]) => policyNames.has(name))),
  );

  const steps = await tx
    .select({
      authenticator: authenticationExecutions.authenticator,
      requirement: authenticationExecutions.requirement,
    })
    .from(authenticationExecutions)
    .where(eq(authenticationExecutions.tenantId, tenantId))
    .orderBy(asc(authenticationExecutions.index));

  const roleRows = await readRoles(tx, tenantId);
  const roleById = new Map(roleRows.map((role) => [role.id, role]));
  const clientRows = await readClients(tx, tenantId);
  const serviceRoles = await subjectRoleReferences(
    tx,
    tenantId,
    clientRows.flatMap((row) => (row.serviceSubjectId === null ? [] : [row.serviceSubjectId])),
    roleById,
  );
  const exportedClients: ExportedClient[] = clientRows.map((row) => ({
    ...row.exported,
    service_account_roles:
      row.serviceSubjectId === null ? [] : (serviceRoles.get(row.serviceSubjectId) ?? []),
  }));
  const exportedGroups = await exportGroups(tx, tenantId, roleById);
  const smtp = await tenantSmtpRepository(tx).byTenantId(tenantId);

  const omitted = clientRows.flatMap((row, index) => [
    ...(row.exported.type === 'confidential' ? [`clients[${String(index)}].secret`] : []),
    ...row.strippedKeys.map((key) => `clients[${String(index)}].jwks.keys[${String(key)}]`),
  ]);
  if (smtp !== null && smtp.passwordEncrypted !== null) omitted.push('smtp.password');

  const document: TenantDocument = {
    version: 1,
    settings,
    flow: steps,
    clients: exportedClients,
    roles: await exportRoles(tx, tenantId, roleRows, roleById),
    groups: exportedGroups.groups,
    scopes: await exportScopes(tx, tenantId, roleById),
    registration_policy: registrationPolicy,
    smtp: exportSmtp(smtp),
    omitted,
  };

  if (input.includeSubjects) {
    const exported = await exportSubjects(tx, tenantId, roleById, exportedGroups.pathById);
    document.subjects = exported.subjects;
    for (const index of exported.credentialed) {
      omitted.push(`subjects[${String(index)}].credentials`);
    }
  }

  await deps.audit(tx, {
    action: 'tenant.export',
    resourceType: 'tenant',
    resourceId: tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { include_subjects: input.includeSubjects },
  });

  return { kind: 'exported', document };
}
