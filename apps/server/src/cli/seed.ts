import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { tenantSettingsRepository, sendVerificationEmail } from '@odudu/account';
import { provisionTenant, requiredActionRepository } from '@odudu/authn-flows';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import {
  createDatabase,
  tenants,
  withTenant,
  type Database,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  evaluatePassword,
  hashPassword,
  subjectRepository,
  userRepository,
  verifyPassword,
  type PasswordPolicy,
  type ProfileUpdate,
} from '@odudu/domain-identity';
import {
  clientRegistrationTokenRepository,
  clientRepository,
  clientScopeRepository,
  provisionAdminClient,
  provisionClientDefaults,
  verifyClientSecret,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  type ClientRecord,
  type ClientScopeAssignment,
  coerceTenantSetting,
} from '@odudu/domain-tenant';
import { loadConfig, newId, OduduError } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  GRANT_TYPES_PERMITTED,
  provisionAdminClientOidc,
  tenantLookupRepository,
  type ClientOidcConfig,
} from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';
import { createLogger } from '#/logger';

// A confidential client's method of proving its secret at /token: either
// RFC 6749 §2.3.1 form. Public clients are always seeded as 'none'. Omitted
// means `client_secret_basic` on a re-run as much as on a first run, since
// seed asserts the whole desired state — re-running against a client
// registered for `client_secret_post` without naming it again is a
// conflict, not a no-op.
type ConfidentialTokenEndpointAuthMethod = Extract<
  ClientOidcConfig['tokenEndpointAuthMethod'],
  'client_secret_basic' | 'client_secret_post'
>;

export interface SeedOptions {
  tenant: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: ConfidentialTokenEndpointAuthMethod;
  redirectUris: string[];
  username?: string;
  password?: string;
  // The seeded user is the one every demo and end-to-end run authenticates
  // as, so it is the only user whose `email` claim anything exercises. What
  // an address may be is `users_email_addr_spec`'s business
  // (packages/db/drizzle/0012_users_email_addr_spec.sql); this only decides
  // whether there is one.
  email?: string;
  // Keycloak's admin console exposes "Send verification email" as an
  // operator action on a user, independent of the tenant's own verify_email
  // setting: the operator is asserting the address is real, not asking
  // self-registration to police it. This is that action, reachable before
  // an admin API exists.
  sendVerificationEmail?: boolean;
  // Where the mailed link points. Only meaningful with sendVerificationEmail;
  // defaults to what a developer running the compose stack sees the server
  // answer on.
  issuerBase?: string;
}

export interface SeedResult {
  created: boolean;
  tenant: string;
  tenantId: string;
  clientId: string;
  userSubjectId?: string;
}

function isAbsoluteUri(uri: string): boolean {
  try {
    return Boolean(new URL(uri));
  } catch {
    return false;
  }
}

function assertAbsoluteRedirectUris(redirectUris: string[]): void {
  for (const uri of redirectUris) {
    if (!isAbsoluteUri(uri)) {
      throw new OduduError(
        'seed_invalid_options',
        `redirect URI must be absolute, got ${JSON.stringify(uri)}`,
      );
    }
  }
}

function assertUserOptionsPaired(opts: SeedOptions): void {
  if ((opts.username === undefined) !== (opts.password === undefined)) {
    throw new OduduError(
      'seed_invalid_options',
      'username and password must be supplied together, or not at all',
    );
  }
}

function assertEmailHasAUser(opts: SeedOptions): void {
  if (opts.email !== undefined && opts.username === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'email belongs to a user, so it needs a username and password alongside it',
    );
  }
}

function assertSendVerificationEmailHasEmail(opts: SeedOptions): void {
  if (opts.sendVerificationEmail === true && opts.email === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'sendVerificationEmail requires an email address to send it to',
    );
  }
}

// A token endpoint auth method describes how a confidential client proves
// its secret; a public client has no secret to prove, so naming a method
// without one is a contradiction rather than a preference to honour.
function assertAuthMethodPairedWithSecret(opts: SeedOptions): void {
  if (opts.tokenEndpointAuthMethod !== undefined && opts.clientSecret === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'tokenEndpointAuthMethod requires a client secret',
    );
  }
}

function sameRedirectUris(stored: string[], given: string[]): boolean {
  if (stored.length !== given.length) return false;
  const sortedStored = [...stored].sort();
  const sortedGiven = [...given].sort();
  return sortedStored.every((uri, index) => uri === sortedGiven[index]);
}

// A second run supplying different values for an already-seeded tenant
// refuses rather than silently ignoring or overwriting them — a changed
// password or redirect URI that appears to "just work" the same as before
// is how a bootstrap tool loses someone an afternoon.
async function assertMatchesExisting(
  tx: TenantScopedDatabase,
  existingClient: ClientRecord,
  opts: SeedOptions,
): Promise<void> {
  const expectedType = opts.clientSecret === undefined ? 'public' : 'confidential';
  if (existingClient.type !== expectedType) {
    throw new OduduError(
      'seed_conflict',
      `client ${opts.clientId} already exists as a ${existingClient.type} client`,
    );
  }

  const secretMatches = await verifyClientSecret(
    existingClient,
    opts.clientSecret ?? null,
    verifyPassword,
  );
  if (!secretMatches) {
    throw new OduduError(
      'seed_conflict',
      `client ${opts.clientId} already exists with a different client secret`,
    );
  }

  const config = await clientOidcConfigRepository(tx).byClientId(existingClient.id);
  if (config !== null && !sameRedirectUris(config.redirectUris, opts.redirectUris)) {
    throw new OduduError(
      'seed_conflict',
      `client ${opts.clientId} already exists with different redirect URIs`,
    );
  }

  // Every other option here is compared against what was asked for, and
  // this one is no different: an omitted auth method is not "whatever is
  // already there", it is the default that a first run would have created.
  // Saying which of the two the run asserted, and how, is the difference
  // between a message an operator can act on and one that reads like a bug.
  const expectedAuthMethod = opts.tokenEndpointAuthMethod ?? 'client_secret_basic';
  if (
    config !== null &&
    expectedType === 'confidential' &&
    config.tokenEndpointAuthMethod !== expectedAuthMethod
  ) {
    const source =
      opts.tokenEndpointAuthMethod === undefined
        ? 'the default applied when --token-endpoint-auth-method is omitted'
        : 'requested with --token-endpoint-auth-method';
    throw new OduduError(
      'seed_conflict',
      `client ${opts.clientId} already exists with token endpoint auth method ` +
        `${config.tokenEndpointAuthMethod}, but this run asks for ${expectedAuthMethod} ` +
        `(${source})`,
    );
  }

  if (opts.username !== undefined && opts.password !== undefined) {
    const existingUser = await userRepository(tx).byUsername(opts.username);
    if (existingUser === null) {
      // The client already exists, so this run's job is only to verify
      // agreement with what was seeded before — it never creates a second
      // user against an existing client. Silently accepting a username
      // that was never seeded would exit 0 having done nothing, which is
      // worse than refusing: refuse, so the operator adds the user through
      // a fresh tenant/client or notices the typo.
      throw new OduduError(
        'seed_conflict',
        `client ${opts.clientId} already exists in tenant ${opts.tenant}, but user ${opts.username} was not seeded with it; seed does not add users to an existing client`,
      );
    }

    // An omitted --email asserts no address, the same way an omitted
    // --token-endpoint-auth-method asserts the default: a run that quietly
    // left a previously seeded address alone would report agreement it had
    // not checked.
    if ((existingUser.user.email ?? undefined) !== opts.email) {
      throw new OduduError(
        'seed_conflict',
        `user ${opts.username} already exists with a different email`,
      );
    }

    const storedHash = await credentialRepository(tx).passwordFor(existingUser.subject.id);
    const passwordMatches =
      storedHash !== null && (await verifyPassword(storedHash, opts.password));
    if (!passwordMatches) {
      throw new OduduError(
        'seed_conflict',
        `user ${opts.username} already exists with a different password`,
      );
    }
  }
}

interface ResolvedTenant {
  tenantId: string;
  created: boolean;
  passwordPolicy: PasswordPolicy;
}

// Read straight off `tenants` rather than through @odudu/protocol-oidc's
// tenantLookupRepository: that repository's TenantLookup is shared by every
// OIDC usecase that resolves a tenant (discovery, jwks, login), and widening
// it here would force a password policy onto fakes that have nothing to do
// with one. The seed CLI is the one caller in this file that writes a
// password, so it is the one that needs this column set.
async function passwordPolicyFor(ownerDb: Database, tenantId: string): Promise<PasswordPolicy> {
  const rows = await ownerDb
    .select({
      passwordMinLength: tenants.passwordMinLength,
      passwordRequireDigit: tenants.passwordRequireDigit,
      passwordRequireUppercase: tenants.passwordRequireUppercase,
      passwordRequireLowercase: tenants.passwordRequireLowercase,
      passwordRequireSpecial: tenants.passwordRequireSpecial,
      passwordNotUsername: tenants.passwordNotUsername,
      passwordNotEmail: tenants.passwordNotEmail,
      passwordHistoryDepth: tenants.passwordHistoryDepth,
      passwordMaxAgeDays: tenants.passwordMaxAgeDays,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const row = rows[0];
  if (row === undefined) {
    throw new OduduError('seed_not_found', `no tenant with id ${JSON.stringify(tenantId)}`);
  }
  return {
    minLength: row.passwordMinLength,
    requireDigit: row.passwordRequireDigit,
    requireUppercase: row.passwordRequireUppercase,
    requireLowercase: row.passwordRequireLowercase,
    requireSpecial: row.passwordRequireSpecial,
    notUsername: row.passwordNotUsername,
    notEmail: row.passwordNotEmail,
    historyDepth: row.passwordHistoryDepth,
    maxAgeDays: row.passwordMaxAgeDays,
  };
}

async function resolveTenantId(ownerDb: Database, tenantName: string): Promise<ResolvedTenant> {
  const lookup = tenantLookupRepository(ownerDb);
  const existing = await lookup.byName(tenantName);
  if (existing !== null) {
    return {
      tenantId: existing.id,
      created: false,
      passwordPolicy: await passwordPolicyFor(ownerDb, existing.id),
    };
  }

  const tenantId = newId();
  await lookup.create({ id: tenantId, name: tenantName });
  return { tenantId, created: true, passwordPolicy: await passwordPolicyFor(ownerDb, tenantId) };
}

// The seed CLI writes to the same password column every other writer does,
// so it is bound by the same tenant policy — there is no development
// exemption for it (packages/db/drizzle/0035_realm_password_policy.sql).
// Never called for a client secret (the two hashPassword(clientSecret)
// call sites below): a client secret is not a user password, and rules
// like not-username/not-email have no subject to check it against.
function assertPasswordSatisfiesPolicy(
  policy: PasswordPolicy,
  username: string,
  email: string | undefined,
  password: string,
): void {
  const violations = evaluatePassword(password, policy, { username, email: email ?? null });
  if (violations.length > 0) {
    throw new OduduError(
      'seed_invalid_options',
      `password does not satisfy the tenant's password policy: ${violations
        .map((v) => v.message)
        .join(' ')}`,
    );
  }
}

async function performSeed(
  ownerDb: Database,
  runtimeDb: Database,
  kek: Uint8Array,
  opts: SeedOptions,
): Promise<SeedResult> {
  const {
    tenantId,
    created: tenantCreated,
    passwordPolicy,
  } = await resolveTenantId(ownerDb, opts.tenant);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    if (tenantCreated) {
      await provisionTenant(tx, tenantId);
    }

    const existingClient = await clientRepository(tx).byClientId(opts.clientId);
    if (existingClient !== null) {
      await assertMatchesExisting(tx, existingClient, opts);
      const existingUser =
        opts.username === undefined ? null : await userRepository(tx).byUsername(opts.username);
      return {
        created: false,
        tenant: opts.tenant,
        tenantId,
        clientId: opts.clientId,
        ...(existingUser !== null ? { userSubjectId: existingUser.subject.id } : {}),
      };
    }

    const type: ClientRecord['type'] = opts.clientSecret === undefined ? 'public' : 'confidential';

    let serviceSubjectId: string | null = null;
    if (type === 'confidential') {
      const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
      serviceSubjectId = serviceSubject.id;
    }

    const secretHash =
      opts.clientSecret === undefined ? null : await hashPassword(opts.clientSecret);

    const client = await clientRepository(tx).create({
      tenantId,
      clientId: opts.clientId,
      name: opts.clientId,
      type,
      secretHash,
      serviceSubjectId,
    });

    // The tenant's standard OIDC vocabulary, without which /authorize would
    // refuse `openid` on this client's very first request.
    await provisionClientDefaults(tx, client.id);

    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      tenantId,
      redirectUris: opts.redirectUris,
      grantTypes:
        type === 'confidential'
          ? ['authorization_code', 'refresh_token', 'client_credentials']
          : ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod:
        type === 'confidential' ? (opts.tokenEndpointAuthMethod ?? 'client_secret_basic') : 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [],
      // No frontchannel_logout_uri or backchannel_logout_uri flag exists
      // here, so isValidLogoutUri and sharesOriginWithRegisteredRedirectUri
      // (packages/protocol-oidc/src/service/client-metadata.ts) are never
      // consulted for a seeded client. Adding either flag must route
      // through parseClientMetadata, or replicate its origin check itself —
      // otherwise a seeded client could carry a logout URI dynamic
      // registration would have refused.
    });

    // Only the tenant's first key: a tenant this seed command already found
    // (rather than just created) may already have one, and a second active
    // key per tenant is a constraint violation, not a valid rotation here.
    const publishableKeys = await signingKeyRepository(tx).listPublishable();
    if (publishableKeys.length === 0) {
      const generated = await generateSigningKey('RS256', kek);
      await signingKeyRepository(tx).create({
        id: newId(),
        tenantId,
        kid: generated.kid,
        alg: generated.alg,
        status: 'active',
        publicJwk: generated.publicJwk,
        privateJwkEncrypted: generated.privateJwkEncrypted,
      });
    }

    let userSubjectId: string | undefined;
    if (opts.username !== undefined && opts.password !== undefined) {
      assertPasswordSatisfiesPolicy(passwordPolicy, opts.username, opts.email, opts.password);
      const userSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      userSubjectId = userSubject.id;
      await userRepository(tx).create({
        subjectId: userSubject.id,
        tenantId,
        username: opts.username,
        ...(opts.email !== undefined ? { email: opts.email } : {}),
      });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: userSubject.id,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword(opts.password) },
      });
    }

    return {
      created: true,
      tenant: opts.tenant,
      tenantId,
      clientId: opts.clientId,
      ...(userSubjectId !== undefined ? { userSubjectId } : {}),
    };
  });
}

// The only way to create the first tenant, client, user and signing key: the
// admin API this would otherwise go through does not exist yet. Reads its
// own configuration and opens its own connections so that both the
// container smoke test and CI can invoke it as a plain one-shot command.
async function seedClientBootstrap(opts: SeedOptions): Promise<SeedResult> {
  assertAbsoluteRedirectUris(opts.redirectUris);
  assertUserOptionsPaired(opts);
  assertEmailHasAUser(opts);
  assertSendVerificationEmailHasEmail(opts);
  assertAuthMethodPairedWithSecret(opts);

  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;

  try {
    const result = await performSeed(owner.db, runtime.db, config.ODUDU_KEK, opts);

    // Sent only after performSeed's transaction commits (withTenant cannot
    // nest), and the userSubjectId check below only satisfies the compiler:
    // assertUserOptionsPaired, assertEmailHasAUser and
    // assertSendVerificationEmailHasEmail together guarantee it is set.
    if (
      opts.sendVerificationEmail === true &&
      opts.email !== undefined &&
      result.userSubjectId !== undefined
    ) {
      const userSubjectId = result.userSubjectId;
      const logger = createLogger(config);
      if (opts.issuerBase === undefined) {
        logger.warn(
          {},
          'sendVerificationEmail: --issuer-base was not given; the mailed link points at ' +
            `http://localhost:${String(config.ODUDU_HTTP_PORT)}, which is wrong for anything but ` +
            'the local compose stack',
        );
      }
      const tenant = await tenantSettingsRepository(owner.db).byName(opts.tenant);
      await sendVerificationEmail(
        {
          database: runtime,
          tenantId: result.tenantId,
          tenantName: result.tenant,
          tenantDisplayName: tenant?.displayName ?? result.tenant,
          issuerBase: opts.issuerBase ?? `http://localhost:${String(config.ODUDU_HTTP_PORT)}`,
        },
        { subjectId: userSubjectId, email: opts.email },
      );
    }

    return result;
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}

// 24 random bytes, base64url: printed once and never stored, so length is
// chosen for pasting rather than for memorability.
function generatedPassword(): string {
  return randomBytes(24).toString('base64url');
}

// Idempotent: a re-run against an already-bootstrapped system tenant leaves
// its signing key alone.
async function ensureSigningKey(
  tx: TenantScopedDatabase,
  tenantId: string,
  kek: Uint8Array,
): Promise<void> {
  const keys = signingKeyRepository(tx);
  if ((await keys.listPublishable()).length > 0) return;
  const generated = await generateSigningKey('ES256', kek);
  await keys.create({
    id: newId(),
    tenantId,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
  });
}

export interface SeedAdminOptions {
  readonly username: string;
}

export interface SeededAdmin {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly password: string;
}

// withTenant binds app.tenant_id to SYSTEM_TENANT_ID before the row exists,
// which is what a FORCE-RLS insert needs (see SYSTEM_TENANT_ID). Idempotent
// throughout: a re-run with a different username reuses the same tenant,
// client and roles, and only adds the new subject.
export async function seedAdmin(options: SeedAdminOptions): Promise<SeededAdmin> {
  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;

  try {
    return await withTenant(runtime.db, SYSTEM_TENANT_ID, async (tx) => {
      const existing = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.name, SYSTEM_TENANT_NAME));
      const tenantId = SYSTEM_TENANT_ID;
      if (existing[0] === undefined) {
        await tx
          .insert(tenants)
          .values({ id: SYSTEM_TENANT_ID, name: SYSTEM_TENANT_NAME, displayName: 'System' });
        // Runs only on the creating pass: provisionTenantDefaults inserts
        // unconditionally, so a re-run would collide with
        // client_scopes_name_unique.
        await provisionTenant(tx, tenantId);
      }
      const { clientDbId } = await provisionAdminClient(tx, tenantId, { crossTenant: true });
      await provisionAdminClientOidc(tx, tenantId, clientDbId);
      await ensureSigningKey(tx, tenantId, config.ODUDU_KEK);

      if ((await userRepository(tx).byUsername(options.username)) !== null) {
        throw new OduduError(
          'seed_admin_exists',
          `a subject named ${JSON.stringify(options.username)} already exists in the system tenant`,
        );
      }

      const password = generatedPassword();
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: subject.id,
        tenantId,
        username: options.username,
      });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword(password) },
      });

      const admin = await roleRepository(tx).byName(TENANT_ADMIN, clientDbId);
      if (admin === null) {
        throw new OduduError('role_not_found', 'tenant-admin was not provisioned');
      }
      await roleRepository(tx).assignToSubject(subject.id, admin.id);
      await requiredActionRepository(tx).add(tenantId, subject.id, 'update-password');

      return { tenantId, subjectId: subject.id, password };
    });
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}

// The tenant, client, user and role model this phase built, exposed one
// subcommand at a time rather than through seedClientBootstrap's single
// combined call — an admin API is a later phase's; this is what makes the
// model provisionable at all in the meantime.
export interface TenantCommandResult {
  command: 'tenant';
  created: boolean;
  tenant: string;
  tenantId: string;
  // The settings this call changed, named as they were given, so a
  // transcript shows what was set rather than only that something was.
  settings?: readonly string[];
}

export interface ClientCommandResult {
  command: 'client';
  created: boolean;
  tenant: string;
  tenantId: string;
  clientId: string;
  clientDbId: string;
}

export interface UserCommandResult {
  command: 'user';
  tenant: string;
  tenantId: string;
  username: string;
  userSubjectId: string;
}

export interface RoleCommandResult {
  command: 'role';
  tenant: string;
  tenantId: string;
  roleId: string;
  name: string;
  clientId: string | null;
}

export interface GroupCommandResult {
  command: 'group';
  tenant: string;
  tenantId: string;
  groupId: string;
  path: string;
}

export interface ScopeCommandResult {
  command: 'scope';
  tenant: string;
  tenantId: string;
  scopeId: string;
  name: string;
}

export interface AssignScopeCommandResult {
  command: 'assign-scope';
  tenant: string;
  tenantId: string;
  clientId: string;
  scope: string;
  assignment: ClientScopeAssignment;
}

export interface MapRoleCommandResult {
  command: 'map-role';
  tenant: string;
  tenantId: string;
  scope: string;
  role: string;
}

export interface GrantRoleCommandResult {
  command: 'grant-role';
  tenant: string;
  tenantId: string;
  username: string;
  role: string;
}

export interface MapGroupRoleCommandResult {
  command: 'map-group-role';
  tenant: string;
  tenantId: string;
  group: string;
  role: string;
}

export interface JoinGroupCommandResult {
  command: 'join-group';
  tenant: string;
  tenantId: string;
  username: string;
  group: string;
}

export interface ProfileCommandResult {
  command: 'profile';
  tenant: string;
  tenantId: string;
  username: string;
}

export interface RegistrationTokenCommandResult {
  command: 'registration-token';
  tenant: string;
  tenantId: string;
  // The only field main.ts prints for this command: the token is a
  // bearer credential meant for a shell to capture, not a field in a JSON
  // report alongside it.
  token: string;
}

export interface AdminCommandResult {
  command: 'admin';
  tenantId: string;
  username: string;
  subjectId: string;
}

export type SeedCommandResult =
  | TenantCommandResult
  | ClientCommandResult
  | UserCommandResult
  | RoleCommandResult
  | GroupCommandResult
  | ScopeCommandResult
  | AssignScopeCommandResult
  | MapRoleCommandResult
  | GrantRoleCommandResult
  | MapGroupRoleCommandResult
  | JoinGroupCommandResult
  | ProfileCommandResult
  | RegistrationTokenCommandResult
  | AdminCommandResult;

async function requireTenantId(ownerDb: Database, tenantName: string): Promise<string> {
  const found = await tenantLookupRepository(ownerDb).byName(tenantName);
  if (found === null) {
    throw new OduduError('seed_not_found', `no tenant named ${JSON.stringify(tenantName)}`);
  }
  return found.id;
}

async function requireClientDbId(tx: TenantScopedDatabase, clientId: string): Promise<string> {
  const client = await clientRepository(tx).byClientId(clientId);
  if (client === null) {
    throw new OduduError('seed_not_found', `no client named ${JSON.stringify(clientId)}`);
  }
  return client.id;
}

async function requireUserSubjectId(tx: TenantScopedDatabase, username: string): Promise<string> {
  const found = await userRepository(tx).byUsername(username);
  if (found === null) {
    throw new OduduError('seed_not_found', `no user named ${JSON.stringify(username)}`);
  }
  return found.subject.id;
}

async function requireScopeId(tx: TenantScopedDatabase, scopeName: string): Promise<string> {
  const scope = await clientScopeRepository(tx).byName(scopeName);
  if (scope === null) {
    throw new OduduError('seed_not_found', `no client scope named ${JSON.stringify(scopeName)}`);
  }
  return scope.id;
}

async function requireGroupIdByPath(tx: TenantScopedDatabase, path: string): Promise<string> {
  const group = await groupRepository(tx).byPath(path);
  if (group === null) {
    throw new OduduError('seed_not_found', `no group at path ${JSON.stringify(path)}`);
  }
  return group.id;
}

// A tenant role is bare; a client role is qualified as clientId:roleName,
// which is unambiguous only because roles_name_has_no_colon
// (packages/db/drizzle/0017_roles.sql) refuses ':' inside a role name
// itself. A second colon cannot come from the role name, so it would have
// to come from a client id containing ':', which cannot exist either —
// refuse rather than guess which half is which.
function parseQualifiedRoleName(raw: string): { name: string; clientId: string | null } {
  const first = raw.indexOf(':');
  if (first === -1) return { name: raw, clientId: null };
  if (raw.includes(':', first + 1)) {
    throw new OduduError(
      'seed_invalid_options',
      `role ${JSON.stringify(raw)} has more than one ':' and cannot be split into a client id ` +
        'and a role name unambiguously',
    );
  }
  return { clientId: raw.slice(0, first), name: raw.slice(first + 1) };
}

interface ResolvedRole {
  id: string;
}

async function requireRoleByQualifiedName(
  tx: TenantScopedDatabase,
  qualifiedName: string,
): Promise<ResolvedRole> {
  const { name, clientId } = parseQualifiedRoleName(qualifiedName);
  const clientDbId = clientId === null ? null : await requireClientDbId(tx, clientId);
  const role = await roleRepository(tx).byName(name, clientDbId);
  if (role === null) {
    throw new OduduError('seed_not_found', `no role named ${JSON.stringify(qualifiedName)}`);
  }
  return role;
}

async function runTenantCommand(
  ownerDb: Database,
  runtimeDb: Database,
  kek: Uint8Array,
  argv: readonly string[],
): Promise<TenantCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: { name: { type: 'string' }, set: { type: 'string', multiple: true } },
  });
  if (values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed tenant requires --name');
  }
  const tenantName = values.name;
  // Parsed before the tenant is touched, so a typo in the third --set does
  // not leave the first two applied.
  const settings = parseSettings(values.set ?? []);

  const { tenantId, created } = await resolveTenantId(ownerDb, tenantName);
  if (created) {
    // A tenant's signing key is provisioned the moment the tenant is, rather
    // than deferred to whichever client happens to be seeded first: a
    // tenant with no client yet still needs one the instant it can issue
    // tokens, and "first client triggers key generation" was only ever
    // true because tenant and client used to be seeded in the same call.
    await withTenant(runtimeDb, tenantId, async (tx) => {
      await provisionTenant(tx, tenantId);
      const generated = await generateSigningKey('RS256', kek);
      await signingKeyRepository(tx).create({
        id: newId(),
        tenantId,
        kid: generated.kid,
        alg: generated.alg,
        status: 'active',
        publicJwk: generated.publicJwk,
        privateJwkEncrypted: generated.privateJwkEncrypted,
      });
    });
  }

  if (settings.length > 0) {
    // Whatever the CHECK constraints refuse (migrations 0028, 0035, 0041)
    // refuses this write too: the seed CLI has no development override, in
    // the way it has none for the password policy.
    await withTenant(runtimeDb, tenantId, (tx) =>
      tx
        .update(tenants)
        .set(Object.fromEntries(settings.map(({ column, value }) => [column, value])))
        .where(eq(tenants.id, tenantId)),
    );
  }

  return {
    command: 'tenant',
    created,
    tenant: tenantName,
    tenantId,
    ...(settings.length > 0 ? { settings: settings.map(({ name }) => name) } : {}),
  };
}

interface ParsedSetting {
  // Both spellings: the column is what the UPDATE needs, and the name is
  // what the operator typed, which is what the result echoes back.
  name: string;
  column: string;
  value: boolean | number | string;
}

// `--set name=value`, repeatable. The name is a column name, which is what a
// reader of the schema or of docs/request-paths.md already has in hand.
function parseSettings(assignments: readonly string[]): ParsedSetting[] {
  return assignments.map((assignment) => {
    const separator = assignment.indexOf('=');
    if (separator <= 0) {
      throw new OduduError(
        'seed_invalid_options',
        `--set expects name=value, got ${JSON.stringify(assignment)}`,
      );
    }
    const name = assignment.slice(0, separator);
    // Only the first `=` splits, so a text setting may contain one.
    const outcome = coerceTenantSetting(name, assignment.slice(separator + 1));
    if (outcome.kind === 'unknown_setting') {
      throw new OduduError(
        'seed_unknown_setting',
        `unknown tenant setting ${JSON.stringify(name)}; expected one of ${outcome.known.join(', ')}`,
      );
    }
    if (outcome.kind === 'invalid_value') {
      throw new OduduError(
        'seed_invalid_options',
        `tenant setting ${name} expects ${outcome.expected === 'integer' ? 'an integer' : `a ${outcome.expected}`}`,
      );
    }
    return { name, column: outcome.column, value: outcome.value };
  });
}

// Omitted --grant-type means the grants a seeded client has always
// received, chosen by type — unchanged so an existing invocation is
// unaffected by this flag's addition.
function defaultGrantsFor(type: 'confidential' | 'public'): string[] {
  return type === 'confidential'
    ? ['authorization_code', 'refresh_token', 'client_credentials']
    : ['authorization_code', 'refresh_token'];
}

async function runClientCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<ClientCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      'client-id': { type: 'string' },
      public: { type: 'boolean' },
      'client-secret': { type: 'string' },
      'token-endpoint-auth-method': { type: 'string' },
      'redirect-uri': { type: 'string', multiple: true },
      'post-logout-redirect-uri': { type: 'string', multiple: true },
      'web-origin': { type: 'string', multiple: true },
      'grant-type': { type: 'string', multiple: true },
    },
  });

  if (values.tenant === undefined || values['client-id'] === undefined) {
    throw new OduduError('seed_invalid_options', 'seed client requires --tenant and --client-id');
  }
  if (values.public === true && values['client-secret'] !== undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed client accepts --public or --client-secret, not both',
    );
  }
  if (values.public !== true && values['client-secret'] === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed client requires either --public or --client-secret, so its type is always stated ' +
        'and never guessed from what is missing',
    );
  }

  const authMethod = values['token-endpoint-auth-method'];
  if (
    authMethod !== undefined &&
    authMethod !== 'client_secret_basic' &&
    authMethod !== 'client_secret_post'
  ) {
    throw new OduduError(
      'seed_invalid_options',
      '--token-endpoint-auth-method must be client_secret_basic or client_secret_post',
    );
  }

  const tenantName = values.tenant;
  const clientId = values['client-id'];
  const clientSecret = values['client-secret'];
  const redirectUris = values['redirect-uri'] ?? [];
  const postLogoutRedirectUris = values['post-logout-redirect-uri'] ?? [];
  const webOrigins = values['web-origin'] ?? [];
  assertAbsoluteRedirectUris(redirectUris);
  // RP-Initiated Logout §2 matches these exactly, the same way §3 matches a
  // redirect URI, so a relative one is as meaningless here as there.
  assertAbsoluteRedirectUris(postLogoutRedirectUris);

  const type: ClientRecord['type'] = values.public === true ? 'public' : 'confidential';
  const requestedGrantTypes = values['grant-type'];
  const grantTypes = requestedGrantTypes ?? defaultGrantsFor(type);
  const unknownGrantTypes = grantTypes.filter((name) => !GRANT_TYPES_PERMITTED.has(name));
  if (unknownGrantTypes.length > 0) {
    throw new OduduError(
      'seed_unknown_grant_type',
      `--grant-type names ${unknownGrantTypes.join(', ')}, which this server does not implement`,
    );
  }

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const existing = await clientRepository(tx).byClientId(clientId);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `client ${JSON.stringify(clientId)} already exists in tenant ${JSON.stringify(tenantName)}`,
      );
    }

    let serviceSubjectId: string | null = null;
    if (type === 'confidential') {
      const serviceSubject = await subjectRepository(tx).create({ tenantId, type: 'service' });
      serviceSubjectId = serviceSubject.id;
    }

    const secretHash = clientSecret === undefined ? null : await hashPassword(clientSecret);

    const client = await clientRepository(tx).create({
      tenantId,
      clientId,
      name: clientId,
      type,
      secretHash,
      serviceSubjectId,
    });

    // The tenant's standard OIDC vocabulary, without which /authorize would
    // refuse `openid` on this client's very first request.
    await provisionClientDefaults(tx, client.id);

    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      tenantId,
      redirectUris,
      grantTypes,
      tokenEndpointAuthMethod:
        type === 'confidential' ? (authMethod ?? 'client_secret_basic') : 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      clientCredentialsScopes: [],
      webOrigins,
      postLogoutRedirectUris,
    });

    return {
      command: 'client',
      created: true,
      tenant: tenantName,
      tenantId,
      clientId,
      clientDbId: client.id,
    };
  });
}

async function runUserCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<UserCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      email: { type: 'string' },
    },
  });

  if (
    values.tenant === undefined ||
    values.username === undefined ||
    values.password === undefined
  ) {
    throw new OduduError(
      'seed_invalid_options',
      'seed user requires --tenant, --username and --password',
    );
  }

  const tenantName = values.tenant;
  const username = values.username;
  const password = values.password;
  const email = values.email;

  const tenantId = await requireTenantId(ownerDb, tenantName);
  assertPasswordSatisfiesPolicy(
    await passwordPolicyFor(ownerDb, tenantId),
    username,
    email,
    password,
  );

  const userSubjectId = await withTenant(runtimeDb, tenantId, async (tx) => {
    const existing = await userRepository(tx).byUsername(username);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `user ${JSON.stringify(username)} already exists in tenant ${JSON.stringify(tenantName)}`,
      );
    }

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      tenantId,
      username,
      ...(email !== undefined ? { email } : {}),
    });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(password) },
    });
    return subject.id;
  });

  return { command: 'user', tenant: tenantName, tenantId, username, userSubjectId };
}

async function runRoleCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<RoleCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      name: { type: 'string' },
      'client-id': { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed role requires --tenant and --name');
  }

  const tenantName = values.tenant;
  const roleName = values.name;
  const ownerClientId = values['client-id'];

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const clientDbId =
      ownerClientId === undefined ? null : await requireClientDbId(tx, ownerClientId);
    const role = await roleRepository(tx).create({
      tenantId,
      name: roleName,
      clientId: clientDbId,
    });
    return {
      command: 'role',
      tenant: tenantName,
      tenantId,
      roleId: role.id,
      name: roleName,
      clientId: ownerClientId ?? null,
    };
  });
}

async function runGroupCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<GroupCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      name: { type: 'string' },
      parent: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed group requires --tenant and --name');
  }

  const tenantName = values.tenant;
  const name = values.name;
  const parentPath = values.parent;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const parentId = parentPath === undefined ? null : await requireGroupIdByPath(tx, parentPath);
    const group = await groupRepository(tx).create({ tenantId, name, parentId });
    return { command: 'group', tenant: tenantName, tenantId, groupId: group.id, path: group.path };
  });
}

function parseIncludeFlag(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new OduduError('seed_invalid_options', `${flag} must be true or false, got ${value}`);
}

async function runScopeCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<ScopeCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      'include-in-id-token': { type: 'string' },
      'include-in-access-token': { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed scope requires --tenant and --name');
  }

  const tenantName = values.tenant;
  const name = values.name;
  const description = values.description;
  const includeInIdToken = parseIncludeFlag(values['include-in-id-token'], '--include-in-id-token');
  const includeInAccessToken = parseIncludeFlag(
    values['include-in-access-token'],
    '--include-in-access-token',
  );

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const existing = await clientScopeRepository(tx).byName(name);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `client scope ${JSON.stringify(name)} already exists in tenant ${JSON.stringify(tenantName)}`,
      );
    }

    const scope = await clientScopeRepository(tx).create({
      tenantId,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(includeInIdToken !== undefined ? { includeInIdToken } : {}),
      ...(includeInAccessToken !== undefined ? { includeInAccessToken } : {}),
    });

    return { command: 'scope', tenant: tenantName, tenantId, scopeId: scope.id, name: scope.name };
  });
}

async function runAssignScopeCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<AssignScopeCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      'client-id': { type: 'string' },
      scope: { type: 'string' },
      assignment: { type: 'string' },
    },
  });

  if (
    values.tenant === undefined ||
    values['client-id'] === undefined ||
    values.scope === undefined ||
    values.assignment === undefined
  ) {
    throw new OduduError(
      'seed_invalid_options',
      'seed assign-scope requires --tenant, --client-id, --scope and --assignment',
    );
  }
  if (values.assignment !== 'default' && values.assignment !== 'optional') {
    throw new OduduError('seed_invalid_options', '--assignment must be default or optional');
  }

  const tenantName = values.tenant;
  const clientId = values['client-id'];
  const scopeName = values.scope;
  const assignment: ClientScopeAssignment = values.assignment;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const clientDbId = await requireClientDbId(tx, clientId);
    const scopeId = await requireScopeId(tx, scopeName);
    await clientScopeRepository(tx).assignOrUpdate(clientDbId, scopeId, assignment);
    return {
      command: 'assign-scope',
      tenant: tenantName,
      tenantId,
      clientId,
      scope: scopeName,
      assignment,
    };
  });
}

async function runMapRoleCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<MapRoleCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      scope: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.scope === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed map-role requires --tenant, --scope and --role',
    );
  }

  const tenantName = values.tenant;
  const scopeName = values.scope;
  const roleName = values.role;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const role = await requireRoleByQualifiedName(tx, roleName);
    const scopeId = await requireScopeId(tx, scopeName);
    await roleRepository(tx).mapToClientScope(scopeId, role.id);
    return { command: 'map-role', tenant: tenantName, tenantId, scope: scopeName, role: roleName };
  });
}

async function runGrantRoleCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<GrantRoleCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.username === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed grant-role requires --tenant, --username and --role',
    );
  }

  const tenantName = values.tenant;
  const username = values.username;
  const roleName = values.role;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    // Refused before the subject is even looked up: a typo'd role must
    // never silently create one, the way a typo'd --user against an
    // existing client must never silently create a second user.
    const role = await requireRoleByQualifiedName(tx, roleName);
    const subjectId = await requireUserSubjectId(tx, username);
    await roleRepository(tx).assignToSubject(subjectId, role.id);
    return { command: 'grant-role', tenant: tenantName, tenantId, username, role: roleName };
  });
}

// The only path from the shipped CLI to a group_roles row: without it,
// hierarchical role inheritance (groupRepository.mapRole, tested at
// repository level with ancestor closure) has nothing to provision it —
// grant-role assigns a role directly to a subject, map-role maps one to a
// client scope, and neither reaches a group.
async function runMapGroupRoleCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<MapGroupRoleCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      group: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.group === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed map-group-role requires --tenant, --group and --role',
    );
  }

  const tenantName = values.tenant;
  const groupPath = values.group;
  const roleName = values.role;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const role = await requireRoleByQualifiedName(tx, roleName);
    const groupId = await requireGroupIdByPath(tx, groupPath);
    await groupRepository(tx).mapRole(groupId, role.id);
    return {
      command: 'map-group-role',
      tenant: tenantName,
      tenantId,
      group: groupPath,
      role: roleName,
    };
  });
}

async function runJoinGroupCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<JoinGroupCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      username: { type: 'string' },
      group: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.username === undefined || values.group === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed join-group requires --tenant, --username and --group',
    );
  }

  const tenantName = values.tenant;
  const username = values.username;
  const groupPath = values.group;

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const subjectId = await requireUserSubjectId(tx, username);
    const groupId = await requireGroupIdByPath(tx, groupPath);
    await groupRepository(tx).addToSubject(subjectId, groupId);
    return { command: 'join-group', tenant: tenantName, tenantId, username, group: groupPath };
  });
}

async function runProfileCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<ProfileCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      username: { type: 'string' },
      name: { type: 'string' },
      'given-name': { type: 'string' },
      'family-name': { type: 'string' },
      'middle-name': { type: 'string' },
      nickname: { type: 'string' },
      'preferred-username': { type: 'string' },
      profile: { type: 'string' },
      picture: { type: 'string' },
      website: { type: 'string' },
      gender: { type: 'string' },
      birthdate: { type: 'string' },
      zoneinfo: { type: 'string' },
      locale: { type: 'string' },
      'phone-number': { type: 'string' },
      'phone-number-verified': { type: 'boolean' },
      'address-formatted': { type: 'string' },
      'address-street': { type: 'string' },
      'address-locality': { type: 'string' },
      'address-region': { type: 'string' },
      'address-postal-code': { type: 'string' },
      'address-country': { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.username === undefined) {
    throw new OduduError('seed_invalid_options', 'seed profile requires --tenant and --username');
  }

  const tenantName = values.tenant;
  const username = values.username;

  const patch: ProfileUpdate = {
    ...(values.name !== undefined ? { name: values.name } : {}),
    ...(values['given-name'] !== undefined ? { givenName: values['given-name'] } : {}),
    ...(values['family-name'] !== undefined ? { familyName: values['family-name'] } : {}),
    ...(values['middle-name'] !== undefined ? { middleName: values['middle-name'] } : {}),
    ...(values.nickname !== undefined ? { nickname: values.nickname } : {}),
    ...(values['preferred-username'] !== undefined
      ? { preferredUsername: values['preferred-username'] }
      : {}),
    ...(values.profile !== undefined ? { profile: values.profile } : {}),
    ...(values.picture !== undefined ? { picture: values.picture } : {}),
    ...(values.website !== undefined ? { website: values.website } : {}),
    ...(values.gender !== undefined ? { gender: values.gender } : {}),
    ...(values.birthdate !== undefined ? { birthdate: values.birthdate } : {}),
    ...(values.zoneinfo !== undefined ? { zoneinfo: values.zoneinfo } : {}),
    ...(values.locale !== undefined ? { locale: values.locale } : {}),
    ...(values['phone-number'] !== undefined ? { phoneNumber: values['phone-number'] } : {}),
    ...(values['phone-number-verified'] !== undefined
      ? { phoneNumberVerified: values['phone-number-verified'] }
      : {}),
    ...(values['address-formatted'] !== undefined
      ? { addressFormatted: values['address-formatted'] }
      : {}),
    ...(values['address-street'] !== undefined ? { addressStreet: values['address-street'] } : {}),
    ...(values['address-locality'] !== undefined
      ? { addressLocality: values['address-locality'] }
      : {}),
    ...(values['address-region'] !== undefined ? { addressRegion: values['address-region'] } : {}),
    ...(values['address-postal-code'] !== undefined
      ? { addressPostalCode: values['address-postal-code'] }
      : {}),
    ...(values['address-country'] !== undefined
      ? { addressCountry: values['address-country'] }
      : {}),
  };

  const tenantId = await requireTenantId(ownerDb, tenantName);

  await withTenant(runtimeDb, tenantId, async (tx) => {
    const subjectId = await requireUserSubjectId(tx, username);
    await userRepository(tx).updateProfile(subjectId, patch);
  });

  return { command: 'profile', tenant: tenantName, tenantId, username };
}

function parsePositiveInteger(raw: string, flag: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== raw) {
    throw new OduduError('seed_invalid_options', `${flag} must be a positive integer`);
  }
  return value;
}

async function runRegistrationTokenCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<RegistrationTokenCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      tenant: { type: 'string' },
      uses: { type: 'string' },
      ttl: { type: 'string' },
    },
  });

  if (values.tenant === undefined || values.uses === undefined || values.ttl === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed registration-token requires --tenant, --uses and --ttl',
    );
  }

  const tenantName = values.tenant;
  const uses = parsePositiveInteger(values.uses, '--uses');
  const ttlSeconds = parsePositiveInteger(values.ttl, '--ttl');

  const tenantId = await requireTenantId(ownerDb, tenantName);

  return withTenant(runtimeDb, tenantId, async (tx) => {
    const { token } = await clientRegistrationTokenRepository(tx).mint({
      tenantId,
      uses,
      ttlSeconds,
    });
    return { command: 'registration-token', tenant: tenantName, tenantId, token };
  });
}

// Printed directly rather than folded into main.ts's JSON report: this is
// the one subcommand whose result is a credential nobody can retrieve again.
async function runAdminCommand(argv: readonly string[]): Promise<AdminCommandResult> {
  const { values } = parseArgs({ args: [...argv], options: { username: { type: 'string' } } });
  if (values.username === undefined) {
    throw new OduduError('seed_invalid_options', 'seed admin requires --username');
  }

  const admin = await seedAdmin({ username: values.username });
  console.log(admin.password);
  console.log('This password is shown once and cannot be retrieved again.');
  return {
    command: 'admin',
    tenantId: admin.tenantId,
    username: values.username,
    subjectId: admin.subjectId,
  };
}

// Exported so main.ts can tell, before parsing anything, whether an
// invocation names one of these subcommands or is the older
// seedClientBootstrap form (`seed --tenant ... --client ...`) — the two
// argv shapes are otherwise indistinguishable from the outside.
export const SEED_COMMANDS = [
  'tenant',
  'client',
  'user',
  'role',
  'group',
  'scope',
  'assign-scope',
  'map-role',
  'grant-role',
  'map-group-role',
  'join-group',
  'profile',
  'registration-token',
  'admin',
] as const;

type SeedCommand = (typeof SEED_COMMANDS)[number];

function isSeedCommand(value: string): value is SeedCommand {
  return (SEED_COMMANDS as readonly string[]).includes(value);
}

async function runSeedCommand(argv: readonly string[]): Promise<SeedCommandResult> {
  const [command, ...rest] = argv;
  if (command === undefined || !isSeedCommand(command)) {
    throw new OduduError(
      'seed_unknown_command',
      `unknown seed subcommand ${JSON.stringify(command)}; expected one of ${SEED_COMMANDS.join(', ')}`,
    );
  }

  // seedAdmin manages its own connections, so it is dispatched before the
  // owner/runtime pair every other subcommand shares is opened.
  if (command === 'admin') {
    return await runAdminCommand(rest);
  }

  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;

  try {
    switch (command) {
      case 'tenant':
        return await runTenantCommand(owner.db, runtime.db, config.ODUDU_KEK, rest);
      case 'client':
        return await runClientCommand(owner.db, runtime.db, rest);
      case 'user':
        return await runUserCommand(owner.db, runtime.db, rest);
      case 'role':
        return await runRoleCommand(owner.db, runtime.db, rest);
      case 'group':
        return await runGroupCommand(owner.db, runtime.db, rest);
      case 'scope':
        return await runScopeCommand(owner.db, runtime.db, rest);
      case 'assign-scope':
        return await runAssignScopeCommand(owner.db, runtime.db, rest);
      case 'map-role':
        return await runMapRoleCommand(owner.db, runtime.db, rest);
      case 'grant-role':
        return await runGrantRoleCommand(owner.db, runtime.db, rest);
      case 'map-group-role':
        return await runMapGroupRoleCommand(owner.db, runtime.db, rest);
      case 'join-group':
        return await runJoinGroupCommand(owner.db, runtime.db, rest);
      case 'profile':
        return await runProfileCommand(owner.db, runtime.db, rest);
      case 'registration-token':
        return await runRegistrationTokenCommand(owner.db, runtime.db, rest);
      default: {
        const exhaustive: never = command;
        throw new OduduError(
          'seed_unknown_command',
          `unhandled seed subcommand ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}

// Array.isArray narrows a readonly array in the branch that tests true for
// it, but not away from the other branch of a `SeedOptions | readonly
// string[]` union — a known gap in how the standard library types it —
// hence the explicit predicate here instead.
function isArgv(input: SeedOptions | readonly string[]): input is readonly string[] {
  return Array.isArray(input);
}

export function seed(opts: SeedOptions): Promise<SeedResult>;
export function seed(argv: readonly string[]): Promise<SeedCommandResult>;
export function seed(
  input: SeedOptions | readonly string[],
): Promise<SeedResult | SeedCommandResult> {
  if (isArgv(input)) {
    return runSeedCommand(input);
  }
  return seedClientBootstrap(input);
}
