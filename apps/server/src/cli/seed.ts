import { parseArgs } from 'node:util';
import { realmSettingsRepository, sendVerificationEmail } from '@odudu/account';
import { provisionRealm } from '@odudu/authn-flows';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import {
  createDatabase,
  realms,
  withRealm,
  type Database,
  type RealmScopedDatabase,
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
  clientRepository,
  clientScopeRepository,
  provisionClientDefaults,
  verifyClientSecret,
  type ClientRecord,
  type ClientScopeAssignment,
  coerceRealmSetting,
} from '@odudu/domain-realm';
import { loadConfig, newId, OduduError } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  realmLookupRepository,
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
  realm: string;
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
  // operator action on a user, independent of the realm's own verify_email
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
  realm: string;
  realmId: string;
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

// A second run supplying different values for an already-seeded realm
// refuses rather than silently ignoring or overwriting them — a changed
// password or redirect URI that appears to "just work" the same as before
// is how a bootstrap tool loses someone an afternoon.
async function assertMatchesExisting(
  tx: RealmScopedDatabase,
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
      // a fresh realm/client or notices the typo.
      throw new OduduError(
        'seed_conflict',
        `client ${opts.clientId} already exists in realm ${opts.realm}, but user ${opts.username} was not seeded with it; seed does not add users to an existing client`,
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

interface ResolvedRealm {
  realmId: string;
  created: boolean;
  passwordPolicy: PasswordPolicy;
}

// Read straight off `realms` rather than through @odudu/protocol-oidc's
// realmLookupRepository: that repository's RealmLookup is shared by every
// OIDC usecase that resolves a realm (discovery, jwks, login), and widening
// it here would force a password policy onto fakes that have nothing to do
// with one. The seed CLI is the one caller in this file that writes a
// password, so it is the one that needs this column set.
async function passwordPolicyFor(ownerDb: Database, realmId: string): Promise<PasswordPolicy> {
  const rows = await ownerDb
    .select({
      passwordMinLength: realms.passwordMinLength,
      passwordRequireDigit: realms.passwordRequireDigit,
      passwordRequireUppercase: realms.passwordRequireUppercase,
      passwordRequireLowercase: realms.passwordRequireLowercase,
      passwordRequireSpecial: realms.passwordRequireSpecial,
      passwordNotUsername: realms.passwordNotUsername,
      passwordNotEmail: realms.passwordNotEmail,
      passwordHistoryDepth: realms.passwordHistoryDepth,
      passwordMaxAgeDays: realms.passwordMaxAgeDays,
    })
    .from(realms)
    .where(eq(realms.id, realmId));
  const row = rows[0];
  if (row === undefined) {
    throw new OduduError('seed_not_found', `no realm with id ${JSON.stringify(realmId)}`);
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

async function resolveRealmId(ownerDb: Database, realmName: string): Promise<ResolvedRealm> {
  const lookup = realmLookupRepository(ownerDb);
  const existing = await lookup.byName(realmName);
  if (existing !== null) {
    return {
      realmId: existing.id,
      created: false,
      passwordPolicy: await passwordPolicyFor(ownerDb, existing.id),
    };
  }

  const realmId = newId();
  await lookup.create({ id: realmId, name: realmName });
  return { realmId, created: true, passwordPolicy: await passwordPolicyFor(ownerDb, realmId) };
}

// The seed CLI writes to the same password column every other writer does,
// so it is bound by the same realm policy — there is no development
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
      `password does not satisfy the realm's password policy: ${violations
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
    realmId,
    created: realmCreated,
    passwordPolicy,
  } = await resolveRealmId(ownerDb, opts.realm);

  return withRealm(runtimeDb, realmId, async (tx) => {
    if (realmCreated) {
      await provisionRealm(tx, realmId);
    }

    const existingClient = await clientRepository(tx).byClientId(opts.clientId);
    if (existingClient !== null) {
      await assertMatchesExisting(tx, existingClient, opts);
      const existingUser =
        opts.username === undefined ? null : await userRepository(tx).byUsername(opts.username);
      return {
        created: false,
        realm: opts.realm,
        realmId,
        clientId: opts.clientId,
        ...(existingUser !== null ? { userSubjectId: existingUser.subject.id } : {}),
      };
    }

    const type: ClientRecord['type'] = opts.clientSecret === undefined ? 'public' : 'confidential';

    let serviceSubjectId: string | null = null;
    if (type === 'confidential') {
      const serviceSubject = await subjectRepository(tx).create({ realmId, type: 'service' });
      serviceSubjectId = serviceSubject.id;
    }

    const secretHash =
      opts.clientSecret === undefined ? null : await hashPassword(opts.clientSecret);

    const client = await clientRepository(tx).create({
      realmId,
      clientId: opts.clientId,
      name: opts.clientId,
      type,
      secretHash,
      serviceSubjectId,
    });

    // The realm's standard OIDC vocabulary, without which /authorize would
    // refuse `openid` on this client's very first request.
    await provisionClientDefaults(tx, client.id);

    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      realmId,
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
    });

    // Only the realm's first key: a realm this seed command already found
    // (rather than just created) may already have one, and a second active
    // key per realm is a constraint violation, not a valid rotation here.
    const publishableKeys = await signingKeyRepository(tx).listPublishable();
    if (publishableKeys.length === 0) {
      const generated = await generateSigningKey('RS256', kek);
      await signingKeyRepository(tx).create({
        id: newId(),
        realmId,
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
      const userSubject = await subjectRepository(tx).create({ realmId, type: 'user' });
      userSubjectId = userSubject.id;
      await userRepository(tx).create({
        subjectId: userSubject.id,
        realmId,
        username: opts.username,
        ...(opts.email !== undefined ? { email: opts.email } : {}),
      });
      await credentialRepository(tx).insert({
        realmId,
        subjectId: userSubject.id,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword(opts.password) },
      });
    }

    return {
      created: true,
      realm: opts.realm,
      realmId,
      clientId: opts.clientId,
      ...(userSubjectId !== undefined ? { userSubjectId } : {}),
    };
  });
}

// The only way to create the first realm, client, user and signing key: the
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

    // Sent only after performSeed's transaction commits (withRealm cannot
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
      const realm = await realmSettingsRepository(owner.db).byName(opts.realm);
      await sendVerificationEmail(
        {
          database: runtime,
          realmId: result.realmId,
          realmName: result.realm,
          realmDisplayName: realm?.displayName ?? result.realm,
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

// The realm, client, user and role model this phase built, exposed one
// subcommand at a time rather than through seedClientBootstrap's single
// combined call — an admin API is a later phase's; this is what makes the
// model provisionable at all in the meantime.
export interface RealmCommandResult {
  command: 'realm';
  created: boolean;
  realm: string;
  realmId: string;
  // The settings this call changed, named as they were given, so a
  // transcript shows what was set rather than only that something was.
  settings?: readonly string[];
}

export interface ClientCommandResult {
  command: 'client';
  created: boolean;
  realm: string;
  realmId: string;
  clientId: string;
  clientDbId: string;
}

export interface UserCommandResult {
  command: 'user';
  realm: string;
  realmId: string;
  username: string;
  userSubjectId: string;
}

export interface RoleCommandResult {
  command: 'role';
  realm: string;
  realmId: string;
  roleId: string;
  name: string;
  clientId: string | null;
}

export interface GroupCommandResult {
  command: 'group';
  realm: string;
  realmId: string;
  groupId: string;
  path: string;
}

export interface ScopeCommandResult {
  command: 'scope';
  realm: string;
  realmId: string;
  scopeId: string;
  name: string;
}

export interface AssignScopeCommandResult {
  command: 'assign-scope';
  realm: string;
  realmId: string;
  clientId: string;
  scope: string;
  assignment: ClientScopeAssignment;
}

export interface MapRoleCommandResult {
  command: 'map-role';
  realm: string;
  realmId: string;
  scope: string;
  role: string;
}

export interface GrantRoleCommandResult {
  command: 'grant-role';
  realm: string;
  realmId: string;
  username: string;
  role: string;
}

export interface MapGroupRoleCommandResult {
  command: 'map-group-role';
  realm: string;
  realmId: string;
  group: string;
  role: string;
}

export interface JoinGroupCommandResult {
  command: 'join-group';
  realm: string;
  realmId: string;
  username: string;
  group: string;
}

export interface ProfileCommandResult {
  command: 'profile';
  realm: string;
  realmId: string;
  username: string;
}

export type SeedCommandResult =
  | RealmCommandResult
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
  | ProfileCommandResult;

async function requireRealmId(ownerDb: Database, realmName: string): Promise<string> {
  const found = await realmLookupRepository(ownerDb).byName(realmName);
  if (found === null) {
    throw new OduduError('seed_not_found', `no realm named ${JSON.stringify(realmName)}`);
  }
  return found.id;
}

async function requireClientDbId(tx: RealmScopedDatabase, clientId: string): Promise<string> {
  const client = await clientRepository(tx).byClientId(clientId);
  if (client === null) {
    throw new OduduError('seed_not_found', `no client named ${JSON.stringify(clientId)}`);
  }
  return client.id;
}

async function requireUserSubjectId(tx: RealmScopedDatabase, username: string): Promise<string> {
  const found = await userRepository(tx).byUsername(username);
  if (found === null) {
    throw new OduduError('seed_not_found', `no user named ${JSON.stringify(username)}`);
  }
  return found.subject.id;
}

async function requireScopeId(tx: RealmScopedDatabase, scopeName: string): Promise<string> {
  const scope = await clientScopeRepository(tx).byName(scopeName);
  if (scope === null) {
    throw new OduduError('seed_not_found', `no client scope named ${JSON.stringify(scopeName)}`);
  }
  return scope.id;
}

async function requireGroupIdByPath(tx: RealmScopedDatabase, path: string): Promise<string> {
  const group = await groupRepository(tx).byPath(path);
  if (group === null) {
    throw new OduduError('seed_not_found', `no group at path ${JSON.stringify(path)}`);
  }
  return group.id;
}

// A realm role is bare; a client role is qualified as clientId:roleName,
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
  tx: RealmScopedDatabase,
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

async function runRealmCommand(
  ownerDb: Database,
  runtimeDb: Database,
  kek: Uint8Array,
  argv: readonly string[],
): Promise<RealmCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: { name: { type: 'string' }, set: { type: 'string', multiple: true } },
  });
  if (values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed realm requires --name');
  }
  const realmName = values.name;
  // Parsed before the realm is touched, so a typo in the third --set does
  // not leave the first two applied.
  const settings = parseSettings(values.set ?? []);

  const { realmId, created } = await resolveRealmId(ownerDb, realmName);
  if (created) {
    // A realm's signing key is provisioned the moment the realm is, rather
    // than deferred to whichever client happens to be seeded first: a
    // realm with no client yet still needs one the instant it can issue
    // tokens, and "first client triggers key generation" was only ever
    // true because realm and client used to be seeded in the same call.
    await withRealm(runtimeDb, realmId, async (tx) => {
      await provisionRealm(tx, realmId);
      const generated = await generateSigningKey('RS256', kek);
      await signingKeyRepository(tx).create({
        id: newId(),
        realmId,
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
    await withRealm(runtimeDb, realmId, (tx) =>
      tx
        .update(realms)
        .set(Object.fromEntries(settings.map(({ column, value }) => [column, value])))
        .where(eq(realms.id, realmId)),
    );
  }

  return {
    command: 'realm',
    created,
    realm: realmName,
    realmId,
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
    const outcome = coerceRealmSetting(name, assignment.slice(separator + 1));
    if (outcome.kind === 'unknown_setting') {
      throw new OduduError(
        'seed_unknown_setting',
        `unknown realm setting ${JSON.stringify(name)}; expected one of ${outcome.known.join(', ')}`,
      );
    }
    if (outcome.kind === 'invalid_value') {
      throw new OduduError(
        'seed_invalid_options',
        `realm setting ${name} expects ${outcome.expected === 'integer' ? 'an integer' : `a ${outcome.expected}`}`,
      );
    }
    return { name, column: outcome.column, value: outcome.value };
  });
}

async function runClientCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<ClientCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      realm: { type: 'string' },
      'client-id': { type: 'string' },
      public: { type: 'boolean' },
      'client-secret': { type: 'string' },
      'token-endpoint-auth-method': { type: 'string' },
      'redirect-uri': { type: 'string', multiple: true },
      'post-logout-redirect-uri': { type: 'string', multiple: true },
      'web-origin': { type: 'string', multiple: true },
    },
  });

  if (values.realm === undefined || values['client-id'] === undefined) {
    throw new OduduError('seed_invalid_options', 'seed client requires --realm and --client-id');
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

  const realmName = values.realm;
  const clientId = values['client-id'];
  const clientSecret = values['client-secret'];
  const redirectUris = values['redirect-uri'] ?? [];
  const postLogoutRedirectUris = values['post-logout-redirect-uri'] ?? [];
  const webOrigins = values['web-origin'] ?? [];
  assertAbsoluteRedirectUris(redirectUris);
  // RP-Initiated Logout §2 matches these exactly, the same way §3 matches a
  // redirect URI, so a relative one is as meaningless here as there.
  assertAbsoluteRedirectUris(postLogoutRedirectUris);

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const existing = await clientRepository(tx).byClientId(clientId);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `client ${JSON.stringify(clientId)} already exists in realm ${JSON.stringify(realmName)}`,
      );
    }

    const type: ClientRecord['type'] = values.public === true ? 'public' : 'confidential';

    let serviceSubjectId: string | null = null;
    if (type === 'confidential') {
      const serviceSubject = await subjectRepository(tx).create({ realmId, type: 'service' });
      serviceSubjectId = serviceSubject.id;
    }

    const secretHash = clientSecret === undefined ? null : await hashPassword(clientSecret);

    const client = await clientRepository(tx).create({
      realmId,
      clientId,
      name: clientId,
      type,
      secretHash,
      serviceSubjectId,
    });

    // The realm's standard OIDC vocabulary, without which /authorize would
    // refuse `openid` on this client's very first request.
    await provisionClientDefaults(tx, client.id);

    await clientOidcConfigRepository(tx).create({
      clientId: client.id,
      realmId,
      redirectUris,
      grantTypes:
        type === 'confidential'
          ? ['authorization_code', 'refresh_token', 'client_credentials']
          : ['authorization_code', 'refresh_token'],
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
      realm: realmName,
      realmId,
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
      realm: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      email: { type: 'string' },
    },
  });

  if (
    values.realm === undefined ||
    values.username === undefined ||
    values.password === undefined
  ) {
    throw new OduduError(
      'seed_invalid_options',
      'seed user requires --realm, --username and --password',
    );
  }

  const realmName = values.realm;
  const username = values.username;
  const password = values.password;
  const email = values.email;

  const realmId = await requireRealmId(ownerDb, realmName);
  assertPasswordSatisfiesPolicy(
    await passwordPolicyFor(ownerDb, realmId),
    username,
    email,
    password,
  );

  const userSubjectId = await withRealm(runtimeDb, realmId, async (tx) => {
    const existing = await userRepository(tx).byUsername(username);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `user ${JSON.stringify(username)} already exists in realm ${JSON.stringify(realmName)}`,
      );
    }

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await userRepository(tx).create({
      subjectId: subject.id,
      realmId,
      username,
      ...(email !== undefined ? { email } : {}),
    });
    await credentialRepository(tx).insert({
      realmId,
      subjectId: subject.id,
      type: 'password',
      secret: { kind: 'password', hash: await hashPassword(password) },
    });
    return subject.id;
  });

  return { command: 'user', realm: realmName, realmId, username, userSubjectId };
}

async function runRoleCommand(
  ownerDb: Database,
  runtimeDb: Database,
  argv: readonly string[],
): Promise<RoleCommandResult> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      realm: { type: 'string' },
      name: { type: 'string' },
      'client-id': { type: 'string' },
    },
  });

  if (values.realm === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed role requires --realm and --name');
  }

  const realmName = values.realm;
  const roleName = values.name;
  const ownerClientId = values['client-id'];

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const clientDbId =
      ownerClientId === undefined ? null : await requireClientDbId(tx, ownerClientId);
    const role = await roleRepository(tx).create({ realmId, name: roleName, clientId: clientDbId });
    return {
      command: 'role',
      realm: realmName,
      realmId,
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
      realm: { type: 'string' },
      name: { type: 'string' },
      parent: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed group requires --realm and --name');
  }

  const realmName = values.realm;
  const name = values.name;
  const parentPath = values.parent;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const parentId = parentPath === undefined ? null : await requireGroupIdByPath(tx, parentPath);
    const group = await groupRepository(tx).create({ realmId, name, parentId });
    return { command: 'group', realm: realmName, realmId, groupId: group.id, path: group.path };
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
      realm: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      'include-in-id-token': { type: 'string' },
      'include-in-access-token': { type: 'string' },
    },
  });

  if (values.realm === undefined || values.name === undefined) {
    throw new OduduError('seed_invalid_options', 'seed scope requires --realm and --name');
  }

  const realmName = values.realm;
  const name = values.name;
  const description = values.description;
  const includeInIdToken = parseIncludeFlag(values['include-in-id-token'], '--include-in-id-token');
  const includeInAccessToken = parseIncludeFlag(
    values['include-in-access-token'],
    '--include-in-access-token',
  );

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const existing = await clientScopeRepository(tx).byName(name);
    if (existing !== null) {
      throw new OduduError(
        'seed_conflict',
        `client scope ${JSON.stringify(name)} already exists in realm ${JSON.stringify(realmName)}`,
      );
    }

    const scope = await clientScopeRepository(tx).create({
      realmId,
      name,
      ...(description !== undefined ? { description } : {}),
      ...(includeInIdToken !== undefined ? { includeInIdToken } : {}),
      ...(includeInAccessToken !== undefined ? { includeInAccessToken } : {}),
    });

    return { command: 'scope', realm: realmName, realmId, scopeId: scope.id, name: scope.name };
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
      realm: { type: 'string' },
      'client-id': { type: 'string' },
      scope: { type: 'string' },
      assignment: { type: 'string' },
    },
  });

  if (
    values.realm === undefined ||
    values['client-id'] === undefined ||
    values.scope === undefined ||
    values.assignment === undefined
  ) {
    throw new OduduError(
      'seed_invalid_options',
      'seed assign-scope requires --realm, --client-id, --scope and --assignment',
    );
  }
  if (values.assignment !== 'default' && values.assignment !== 'optional') {
    throw new OduduError('seed_invalid_options', '--assignment must be default or optional');
  }

  const realmName = values.realm;
  const clientId = values['client-id'];
  const scopeName = values.scope;
  const assignment: ClientScopeAssignment = values.assignment;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const clientDbId = await requireClientDbId(tx, clientId);
    const scopeId = await requireScopeId(tx, scopeName);
    await clientScopeRepository(tx).assignOrUpdate(clientDbId, scopeId, assignment);
    return {
      command: 'assign-scope',
      realm: realmName,
      realmId,
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
      realm: { type: 'string' },
      scope: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.scope === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed map-role requires --realm, --scope and --role',
    );
  }

  const realmName = values.realm;
  const scopeName = values.scope;
  const roleName = values.role;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const role = await requireRoleByQualifiedName(tx, roleName);
    const scopeId = await requireScopeId(tx, scopeName);
    await roleRepository(tx).mapToClientScope(scopeId, role.id);
    return { command: 'map-role', realm: realmName, realmId, scope: scopeName, role: roleName };
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
      realm: { type: 'string' },
      username: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.username === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed grant-role requires --realm, --username and --role',
    );
  }

  const realmName = values.realm;
  const username = values.username;
  const roleName = values.role;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    // Refused before the subject is even looked up: a typo'd role must
    // never silently create one, the way a typo'd --user against an
    // existing client must never silently create a second user.
    const role = await requireRoleByQualifiedName(tx, roleName);
    const subjectId = await requireUserSubjectId(tx, username);
    await roleRepository(tx).assignToSubject(subjectId, role.id);
    return { command: 'grant-role', realm: realmName, realmId, username, role: roleName };
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
      realm: { type: 'string' },
      group: { type: 'string' },
      role: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.group === undefined || values.role === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed map-group-role requires --realm, --group and --role',
    );
  }

  const realmName = values.realm;
  const groupPath = values.group;
  const roleName = values.role;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const role = await requireRoleByQualifiedName(tx, roleName);
    const groupId = await requireGroupIdByPath(tx, groupPath);
    await groupRepository(tx).mapRole(groupId, role.id);
    return {
      command: 'map-group-role',
      realm: realmName,
      realmId,
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
      realm: { type: 'string' },
      username: { type: 'string' },
      group: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.username === undefined || values.group === undefined) {
    throw new OduduError(
      'seed_invalid_options',
      'seed join-group requires --realm, --username and --group',
    );
  }

  const realmName = values.realm;
  const username = values.username;
  const groupPath = values.group;

  const realmId = await requireRealmId(ownerDb, realmName);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const subjectId = await requireUserSubjectId(tx, username);
    const groupId = await requireGroupIdByPath(tx, groupPath);
    await groupRepository(tx).addToSubject(subjectId, groupId);
    return { command: 'join-group', realm: realmName, realmId, username, group: groupPath };
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
      realm: { type: 'string' },
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

  if (values.realm === undefined || values.username === undefined) {
    throw new OduduError('seed_invalid_options', 'seed profile requires --realm and --username');
  }

  const realmName = values.realm;
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

  const realmId = await requireRealmId(ownerDb, realmName);

  await withRealm(runtimeDb, realmId, async (tx) => {
    const subjectId = await requireUserSubjectId(tx, username);
    await userRepository(tx).updateProfile(subjectId, patch);
  });

  return { command: 'profile', realm: realmName, realmId, username };
}

// Exported so main.ts can tell, before parsing anything, whether an
// invocation names one of these subcommands or is the older
// seedClientBootstrap form (`seed --realm ... --client ...`) — the two
// argv shapes are otherwise indistinguishable from the outside.
export const SEED_COMMANDS = [
  'realm',
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

  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;

  try {
    switch (command) {
      case 'realm':
        return await runRealmCommand(owner.db, runtime.db, config.ODUDU_KEK, rest);
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
