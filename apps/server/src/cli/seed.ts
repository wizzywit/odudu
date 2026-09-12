import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import { createDatabase, withRealm, type Database, type RealmScopedDatabase } from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
  verifyPassword,
} from '@odudu/domain-identity';
import { clientRepository, verifyClientSecret, type ClientRecord } from '@odudu/domain-realm';
import { loadConfig, newId, OduduError } from '@odudu/kernel';
import {
  clientOidcConfigRepository,
  realmLookupRepository,
  type ClientOidcConfig,
} from '@odudu/protocol-oidc';

// A confidential client's method of proving its secret at /token: either
// RFC 6749 §2.3.1 form (Authorization header or body parameter). Public
// clients present none of either and are always seeded as 'none' — this
// option only ever changes a confidential client's method.
//
// Omitted means `client_secret_basic`, on a re-run as much as on a first
// run: seed asserts the whole desired state, so re-running against a
// client registered for `client_secret_post` without naming it again is a
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
}

export interface SeedResult {
  created: boolean;
  realm: string;
  realmId: string;
  clientId: string;
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

async function resolveRealmId(ownerDb: Database, realmName: string): Promise<string> {
  const lookup = realmLookupRepository(ownerDb);
  const existing = await lookup.byName(realmName);
  if (existing !== null) return existing.id;

  const realmId = newId();
  await lookup.create({ id: realmId, name: realmName });
  return realmId;
}

async function performSeed(
  ownerDb: Database,
  runtimeDb: Database,
  kek: Uint8Array,
  opts: SeedOptions,
): Promise<SeedResult> {
  const realmId = await resolveRealmId(ownerDb, opts.realm);

  return withRealm(runtimeDb, realmId, async (tx) => {
    const existingClient = await clientRepository(tx).byClientId(opts.clientId);
    if (existingClient !== null) {
      await assertMatchesExisting(tx, existingClient, opts);
      return { created: false, realm: opts.realm, realmId, clientId: opts.clientId };
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

    if (opts.username !== undefined && opts.password !== undefined) {
      const userSubject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await userRepository(tx).create({
        subjectId: userSubject.id,
        realmId,
        username: opts.username,
      });
      await credentialRepository(tx).create({
        realmId,
        subjectId: userSubject.id,
        type: 'password',
        secretData: await hashPassword(opts.password),
      });
    }

    return { created: true, realm: opts.realm, realmId, clientId: opts.clientId };
  });
}

// The only way to create the first realm, client, user and signing key: the
// admin API this would otherwise go through does not exist yet. Reads its
// own configuration and opens its own connections so that both the
// container smoke test and CI can invoke it as a plain one-shot command.
export async function seed(opts: SeedOptions): Promise<SeedResult> {
  assertAbsoluteRedirectUris(opts.redirectUris);
  assertUserOptionsPaired(opts);
  assertAuthMethodPairedWithSecret(opts);

  const config = loadConfig();
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = config.ODUDU_APP_DATABASE_URL
    ? createDatabase(config.ODUDU_APP_DATABASE_URL)
    : owner;

  try {
    return await performSeed(owner.db, runtime.db, config.ODUDU_KEK, opts);
  } finally {
    if (runtime !== owner) await runtime.close();
    await owner.close();
  }
}
