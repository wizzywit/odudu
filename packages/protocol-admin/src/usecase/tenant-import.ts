import { randomBytes } from 'node:crypto';
import {
  executionRepository,
  registeredAuthenticatorNames,
  requiredActionRepository,
} from '@odudu/authn-flows';
import {
  type ExportedClient,
  type ImportError,
  type RoleReference,
  type Tenant,
  type TenantDocument,
} from '@odudu/contracts/admin';
import {
  withTenant,
  type Database,
  type RequestContext,
  type TenantScopedDatabase,
} from '@odudu/db';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { subjectRepository, userRepository, type ProfileUpdate } from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  capabilityRoleGraph,
  clientRepository,
  clientScopeMapperRepository,
  clientScopeRepository,
  TENANT_SETTING_COLUMNS,
  TenantSettingCheckViolationError,
  coerceTenantSetting,
  type TenantSettingValue,
  tenantSettingsRepository,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  type ClientMetadata,
  type ClientOidcConfig,
} from '@odudu/protocol-oidc';
import { tenantSmtpRepository } from '#/repository/tenant-smtp';
import { CLAIM_KEY } from '#/usecase/profile';
import { type MapperCatalogue } from '#/usecase/scope-mappers';
import { roleKey, validateTenantImport } from '#/usecase/tenant-import-validation';
import { insertProvisionedTenant, readTenant, TenantNameTakenError } from '#/usecase/tenants';

export interface TenantImportAuditEvent {
  readonly action: 'tenant.import';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: {
    readonly source_version: number;
    readonly counts: Readonly<Record<string, number>>;
  };
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: TenantImportAuditEvent) => Promise<void>;

export interface ImportTenantDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  readonly audit: Audit;
  /** Registers the console's URIs on the new admin client; unset while the console is off. */
  readonly consoleBaseUrl?: string | undefined;
  readonly hashClientSecret: (secret: string) => Promise<string>;
  readonly tlsClientAuthEnabled: boolean;
  readonly claimMappers: MapperCatalogue;
  /** Through the owner connection: under row-level security no tenant sees another's name. */
  readonly tenantNameTaken: (name: string) => Promise<boolean>;
}

export interface ImportTenantInput {
  readonly name: string;
  readonly displayName: string | undefined;
  readonly document: unknown;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface ImportedClientSecret {
  readonly client_id: string;
  readonly secret: string;
}

export type ImportTenantOutcome =
  | { readonly kind: 'invalid'; readonly errors: readonly ImportError[] }
  | { readonly kind: 'name_taken' }
  | {
      readonly kind: 'created';
      readonly tenant: Tenant;
      readonly clientSecrets: readonly ImportedClientSecret[];
    };

// Matches `generateClientSecret` in #/usecase/clients.ts: 256 bits.
function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}

function required<T>(map: ReadonlyMap<string, T>, key: string, what: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`tenant import: no ${what} for ${JSON.stringify(key)}`);
  return value;
}

function roleIdsOf(
  roleIds: ReadonlyMap<string, string>,
  references: readonly RoleReference[],
): string[] {
  return [...new Set(references.map((reference) => required(roleIds, roleKey(reference), 'role')))];
}

async function writeSettings(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: TenantDocument,
): Promise<void> {
  const values: Readonly<Record<string, unknown>> = {
    ...document.settings,
    ...document.registration_policy,
  };
  const columns: Record<string, TenantSettingValue> = {};
  for (const { name, column } of TENANT_SETTING_COLUMNS) {
    const value = values[name];
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      if (name !== 'display_name') columns[column] = value;
    } else if (Array.isArray(value) && value.every((member) => typeof member === 'string')) {
      const coerced = coerceTenantSetting(name, value);
      if (coerced.kind === 'coerced') columns[column] = coerced.value;
    }
  }
  await tenantSettingsRepository(tx).amend(tenantId, columns);
}

async function writeClient(
  tx: TenantScopedDatabase,
  deps: ImportTenantDeps,
  tenantId: string,
  client: ExportedClient,
  metadata: ClientMetadata,
): Promise<{ id: string; serviceSubjectId: string | null; secret: string | null }> {
  const confidential = client.type === 'confidential';
  const serviceSubjectId = confidential
    ? (await subjectRepository(tx).create({ tenantId, type: 'service' })).id
    : null;
  const secret = confidential ? generateClientSecret() : null;
  const created = await clientRepository(tx).create({
    tenantId,
    clientId: client.client_id,
    name: client.name,
    description: client.description,
    type: client.type,
    secretHash: secret === null ? null : await deps.hashClientSecret(secret),
    enabled: client.enabled,
    serviceSubjectId,
    fullScopeAllowed: client.full_scope_allowed,
    registrationOrigin: client.registration_origin,
  });
  await clientOidcConfigRepository(tx).create({
    clientId: created.id,
    tenantId,
    redirectUris: metadata.redirectUris,
    grantTypes: metadata.grantTypes,
    tokenEndpointAuthMethod:
      metadata.tokenEndpointAuthMethod as ClientOidcConfig['tokenEndpointAuthMethod'],
    audiences: client.audiences,
    accessTokenTtlSeconds: client.access_token_ttl_seconds,
    idTokenTtlSeconds: client.id_token_ttl_seconds,
    refreshTokenTtlSeconds: client.refresh_token_ttl_seconds,
    clientCredentialsScopes: client.client_credentials_scopes,
    webOrigins: client.web_origins,
    postLogoutRedirectUris: client.post_logout_redirect_uris,
    jwks: metadata.jwks,
    jwksUri: metadata.jwksUri,
    frontchannelLogoutUri: metadata.frontchannelLogoutUri,
    backchannelLogoutUri: metadata.backchannelLogoutUri,
    backchannelLogoutSessionRequired: metadata.backchannelLogoutSessionRequired,
    frontchannelLogoutSessionRequired: metadata.frontchannelLogoutSessionRequired,
    consentRequired: client.consent_required,
    tokenExchangeImpersonationAllowed: client.token_exchange_impersonation_allowed,
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
  return { id: created.id, serviceSubjectId, secret };
}

// Built-in roles are provisioned already and only amended; every other role
// is created before any composite, so an edge never names a role not yet
// written.
async function writeRoles(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: TenantDocument,
  clientIds: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const roles = roleRepository(tx);
  const adminClientId = required(clientIds, ADMIN_CLIENT_ID, 'client');
  const roleIds = new Map<string, string>();
  for (const role of document.roles) {
    if (role.builtin) {
      const found = await roles.byName(role.name, adminClientId);
      if (found === null) throw new Error(`tenant import: ${role.name} was not provisioned`);
      if (found.description !== role.description) {
        await roles.amend(found.id, { description: role.description });
      }
      roleIds.set(roleKey(role), found.id);
      continue;
    }
    const created = await roles.create({
      tenantId,
      name: role.name,
      description: role.description,
      clientId: role.client === null ? null : required(clientIds, role.client, 'client'),
      defaultForNewSubjects: role.default_for_new_subjects,
    });
    roleIds.set(roleKey(role), created.id);
  }
  for (const name of capabilityRoleGraph().roles) {
    const key = roleKey({ name, client: ADMIN_CLIENT_ID });
    if (roleIds.has(key)) continue;
    const found = await roles.byName(name, adminClientId);
    if (found !== null) roleIds.set(key, found.id);
  }
  for (const role of document.roles) {
    const parentId = required(roleIds, roleKey(role), 'role');
    for (const childId of roleIdsOf(roleIds, role.composites)) {
      await roles.addComposite(parentId, childId);
    }
  }
  return roleIds;
}

async function writeGroups(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: TenantDocument,
  roleIds: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const groups = groupRepository(tx);
  const groupIds = new Map<string, string>();
  const depth = (path: string): number => path.split('/').length;
  const ordered = [...document.groups].sort((a, b) => depth(a.path) - depth(b.path));
  for (const group of ordered) {
    const cut = group.path.lastIndexOf('/');
    const parentPath = group.path.slice(0, cut);
    const created = await groups.create({
      tenantId,
      name: group.path.slice(cut + 1),
      parentId: parentPath === '' ? null : required(groupIds, parentPath, 'group'),
      description: group.description,
    });
    if (group.default_for_new_subjects) {
      await groups.setDefaultForNewSubjects(created.id, true);
    }
    groupIds.set(group.path, created.id);
    await groups.setRoles(created.id, roleIdsOf(roleIds, group.roles));
  }
  return groupIds;
}

// A built-in scope is provisioned already: its editable attributes are
// applied, and one the document leaves out was deleted where it came from.
async function writeScopes(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: TenantDocument,
  roleIds: ReadonlyMap<string, string>,
  clientIds: ReadonlyMap<string, string>,
): Promise<void> {
  const scopes = clientScopeRepository(tx);
  const named = new Set(document.scopes.map((scope) => scope.name));
  for (const provisioned of await scopes.allForTenant()) {
    if (!named.has(provisioned.name)) await scopes.delete(provisioned.id);
  }
  for (const scope of document.scopes) {
    const attributes = {
      description: scope.description,
      includeInIdToken: scope.include_in_id_token,
      includeInAccessToken: scope.include_in_access_token,
      defaultClientAssignment: scope.default_client_assignment,
      consentText: scope.consent_text,
      displayOrder: scope.display_order,
    };
    let scopeId: string;
    if (scope.builtin) {
      const found = await scopes.byName(scope.name);
      if (found === null) throw new Error(`tenant import: ${scope.name} was not provisioned`);
      await scopes.amend(found.id, attributes);
      scopeId = found.id;
    } else {
      scopeId = (await scopes.create({ tenantId, name: scope.name, ...attributes })).id;
    }
    await roleRepository(tx).setClientScopeRoles(scopeId, roleIdsOf(roleIds, scope.roles));
    await clientScopeMapperRepository(tx).replaceForScope(tenantId, scopeId, [
      ...new Set(scope.mappers),
    ]);
    for (const entry of scope.clients) {
      await scopes.assign(
        required(clientIds, entry.client_id, 'client'),
        scopeId,
        entry.assignment,
      );
    }
  }
}

async function writeSubjects(
  tx: TenantScopedDatabase,
  tenantId: string,
  document: TenantDocument,
  roleIds: ReadonlyMap<string, string>,
  groupIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const subject of document.subjects ?? []) {
    const { id } = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const users = userRepository(tx);
    await users.create({
      subjectId: id,
      tenantId,
      username: subject.username,
      email: subject.email,
    });
    const claims: ProfileUpdate = {};
    for (const [field, value] of Object.entries(subject.profile)) {
      const key = CLAIM_KEY[field];
      if (key !== undefined && (typeof value === 'string' || value === null)) claims[key] = value;
    }
    await users.updateProfile(id, claims);
    await users.setVerification(id, {
      emailVerified: subject.profile.email_verified,
      phoneNumberVerified: subject.profile.phone_number_verified,
    });
    if (!subject.enabled) await subjectRepository(tx).setEnabled(id, false);
    for (const roleId of roleIdsOf(roleIds, subject.roles)) {
      await roleRepository(tx).assignToSubject(id, roleId);
    }
    for (const path of new Set(subject.groups)) {
      await groupRepository(tx).addToSubject(id, required(groupIds, path, 'group'));
    }
    // No credential travels in a document, so every subject sets its own.
    for (const action of new Set([...subject.required_actions, 'update-password' as const])) {
      await requiredActionRepository(tx).add(tenantId, id, action);
    }
  }
}

async function writeDocument(
  tx: TenantScopedDatabase,
  deps: ImportTenantDeps,
  tenantId: string,
  document: TenantDocument,
  metadata: ReadonlyMap<string, ClientMetadata>,
): Promise<ImportedClientSecret[]> {
  await writeSettings(tx, tenantId, document);
  await executionRepository(tx).replaceForTenant(tenantId, document.flow);

  const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
  if (admin === null) throw new Error('tenant import: the admin client was not provisioned');
  const clientIds = new Map<string, string>([[ADMIN_CLIENT_ID, admin.id]]);
  const serviceSubjects = new Map<string, string>();
  const secrets: ImportedClientSecret[] = [];
  for (const client of document.clients) {
    const written = await writeClient(
      tx,
      deps,
      tenantId,
      client,
      required(metadata, client.client_id, 'client metadata'),
    );
    clientIds.set(client.client_id, written.id);
    if (written.serviceSubjectId !== null) {
      serviceSubjects.set(client.client_id, written.serviceSubjectId);
    }
    if (written.secret !== null) {
      secrets.push({ client_id: client.client_id, secret: written.secret });
    }
  }

  const roleIds = await writeRoles(tx, tenantId, document, clientIds);
  const groupIds = await writeGroups(tx, tenantId, document, roleIds);
  await writeScopes(tx, tenantId, document, roleIds, clientIds);
  for (const client of document.clients) {
    const serviceSubjectId = serviceSubjects.get(client.client_id);
    if (serviceSubjectId === undefined) continue;
    for (const roleId of roleIdsOf(roleIds, client.service_account_roles)) {
      await roleRepository(tx).assignToSubject(serviceSubjectId, roleId);
    }
  }
  if (document.smtp !== null) {
    await tenantSmtpRepository(tx).upsert(tenantId, {
      host: document.smtp.host,
      port: document.smtp.port,
      fromAddress: document.smtp.from_address,
      username: document.smtp.username,
      passwordEncrypted: null,
      starttls: document.smtp.starttls,
    });
  }
  await writeSubjects(tx, tenantId, document, roleIds, groupIds);
  return secrets;
}

/**
 * Creates a new tenant from a document another tenant exported. Nothing is
 * written until the whole request is known good; then one transaction
 * provisions the tenant as `createTenant` does — its own signing key and
 * admin client — and writes every record in dependency order. Each
 * confidential client gets a fresh secret, answered here and nowhere else.
 */
export async function importTenant(
  deps: ImportTenantDeps,
  input: ImportTenantInput,
  context: RequestContext,
): Promise<ImportTenantOutcome> {
  const validated = validateTenantImport(input.name, input.document, {
    knownMappers: deps.claimMappers.mapperNames(),
    knownAuthenticators: registeredAuthenticatorNames(),
    tlsClientAuthEnabled: deps.tlsClientAuthEnabled,
    callerCapabilities: input.callerCapabilities,
  });
  if (validated.kind === 'invalid') return validated;
  if (await deps.tenantNameTaken(input.name)) return { kind: 'name_taken' };
  const { document, metadata } = validated;

  const id = newId();
  try {
    return await withTenant(
      deps.database,
      id,
      async (tx) => {
        await insertProvisionedTenant(
          tx,
          deps.kek,
          {
            id,
            name: input.name,
            displayName: input.displayName ?? document.settings.display_name,
          },
          deps.consoleBaseUrl,
        );
        const clientSecrets = await writeDocument(tx, deps, id, document, metadata);

        await deps.audit(tx, {
          action: 'tenant.import',
          resourceType: 'tenant',
          resourceId: id,
          actorSubjectId: input.actorSubjectId,
          actorTenantId: input.actorTenantId,
          actorClientId: input.actorClientId,
          outcome: 'allowed',
          detail: {
            source_version: document.version,
            counts: {
              clients: document.clients.length,
              roles: document.roles.length,
              groups: document.groups.length,
              scopes: document.scopes.length,
              subjects: document.subjects?.length ?? 0,
            },
          },
        });

        const tenant = await readTenant(tx, id);
        if (tenant.kind !== 'ok') throw new Error(`tenant ${id} not found after its own import`);
        return { kind: 'created' as const, tenant: tenant.tenant, clientSecrets };
      },
      context,
    );
  } catch (error) {
    // Either leaves the transaction rolled back, with nothing of the tenant
    // written. The settings refusal is a backstop: `tenantSettingProblems`
    // already refused every range its CHECKs hold, before any write.
    if (error instanceof TenantNameTakenError) return { kind: 'name_taken' };
    if (error instanceof TenantSettingCheckViolationError) {
      return {
        kind: 'invalid',
        errors: [
          { path: 'document.settings', message: 'a setting is outside its permitted range' },
        ],
      };
    }
    throw error;
  }
}
