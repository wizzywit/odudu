import { generateSigningKey, signingKeys } from '@odudu/crypto';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { provisionRealm } from '@odudu/authn-flows';
import { clientScopeRepository, clients, provisionClientDefaults } from '@odudu/domain-realm';
import { roleRepository, type RoleRecord } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const REDIRECT_URI = 'https://app.example/callback';

// RFC 7636 Appendix B worked example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

interface Realm {
  realmName: string;
  realmId: string;
  clientDbId: string;
  subjectId: string;
}

async function seedRealm(label: string): Promise<Realm> {
  const realmName = `role-claims-${label}-${newId()}`;
  const realmId = newId();
  const clientDbId = newId();

  const subjectId = await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name: realmName });
    await provisionRealm(tx, realmId);

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: `alice-${label}` });

    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: 'web-app',
      name: 'Web app',
      type: 'confidential',
      secretHash: await hashPassword('supersecret'),
    });
    await provisionClientDefaults(tx, clientDbId);

    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    return subject.id;
  });

  return { realmName, realmId, clientDbId, subjectId };
}

// A realm role held by the realm's subject, with no scope mapping unless
// mapRoleToScope adds one — the "held but not reachable" fixture every
// negative assertion below depends on.
async function giveSubjectRole(realm: Realm, name: string): Promise<RoleRecord> {
  return withRealm(app.db, realm.realmId, async (tx) => {
    const role = await roleRepository(tx).create({ realmId: realm.realmId, name });
    await roleRepository(tx).assignToSubject(realm.subjectId, role.id);
    return role;
  });
}

async function mapRoleToScope(realm: Realm, role: RoleRecord, scopeName: string): Promise<void> {
  await withRealm(app.db, realm.realmId, async (tx) => {
    const scope = await clientScopeRepository(tx).byName(scopeName);
    if (scope === null) throw new Error(`no client scope named ${scopeName}`);
    await roleRepository(tx).mapToClientScope(scope.id, role.id);
  });
}

async function setFullScopeAllowed(realm: Realm): Promise<void> {
  await withRealm(app.db, realm.realmId, (tx) =>
    tx.execute(sql`update clients set full_scope_allowed = true where id = ${realm.clientDbId}`),
  );
}

async function disableClient(realm: Realm): Promise<void> {
  await withRealm(app.db, realm.realmId, (tx) =>
    tx.execute(sql`update clients set enabled = false where id = ${realm.clientDbId}`),
  );
}

async function setIncludeInAccessToken(
  realm: Realm,
  scopeName: string,
  value: boolean,
): Promise<void> {
  await withRealm(app.db, realm.realmId, (tx) =>
    tx.execute(
      sql`update client_scopes set include_in_access_token = ${value} where realm_id = ${realm.realmId} and name = ${scopeName}`,
    ),
  );
}

interface TokenSet {
  accessToken: string;
  idToken: string | undefined;
}

async function completeCodeFlow(realm: Realm, scope: string): Promise<TokenSet> {
  const code = generateAuthorizationCode();

  await withRealm(app.db, realm.realmId, async (tx) => {
    await authorizationCodeRepository(tx).create({
      codeHash: hashAuthorizationCode(code),
      realmId: realm.realmId,
      clientId: realm.clientDbId,
      subjectId: realm.subjectId,
      redirectUri: REDIRECT_URI,
      scope,
      nonce: null,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      authTime: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resource: [],
    });
  });

  const form = new URLSearchParams();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('redirect_uri', REDIRECT_URI);
  form.set('code_verifier', VERIFIER);

  const res = await http.inject({
    method: 'POST',
    url: `/realms/${realm.realmName}/protocol/openid-connect/token`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('web-app:supersecret').toString('base64')}`,
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json<{ access_token: string; id_token?: string }>();
  return { accessToken: body.access_token, idToken: body.id_token };
}

async function userinfo(realm: Realm, accessToken: string): Promise<Record<string, unknown>> {
  const res = await http.inject({
    method: 'GET',
    url: `/realms/${realm.realmName}/protocol/openid-connect/userinfo`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

// Decodes without verifying: used only to read what issuance minted, never
// to make a trust decision.
function decode(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;

  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('roles in an issued token', () => {
  it('withholds a held role that the client scopes do not reach', async () => {
    const realm = await seedRealm('unmapped');
    await giveSubjectRole(realm, 'admin'); // held, but mapped to no scope

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect(decode(accessToken)).not.toHaveProperty('roles');
  });

  it('withholds the roles claim entirely when nothing is mapped', async () => {
    const realm = await seedRealm('nothing-mapped');
    // Two held roles, neither mapped to anything — not just the one role
    // the previous test leaves unmapped, so an implementation that only
    // drops a single excess role rather than intersecting the whole set
    // still fails this one.
    await giveSubjectRole(realm, 'admin');
    await giveSubjectRole(realm, 'member');

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect(decode(accessToken)).not.toHaveProperty('roles');
  });

  it('emits a role once its scope is mapped', async () => {
    const realm = await seedRealm('mapped');
    const admin = await giveSubjectRole(realm, 'admin');
    await mapRoleToScope(realm, admin, 'roles');

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect(decode(accessToken).roles).toEqual(['admin']);
  });

  it('passes every held role through when the client has full scope', async () => {
    const realm = await seedRealm('full-scope');
    await setFullScopeAllowed(realm);
    await giveSubjectRole(realm, 'admin'); // held, mapped to no scope, but full_scope_allowed

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect(decode(accessToken).roles).toEqual(['admin']);
  });

  it('keeps roles out of the ID token, which the browser sees', async () => {
    const realm = await seedRealm('id-token');
    const admin = await giveSubjectRole(realm, 'admin');
    await mapRoleToScope(realm, admin, 'roles');

    const { idToken } = await completeCodeFlow(realm, 'openid roles');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(decode(idToken)).not.toHaveProperty('roles');
  });

  it('returns them from userinfo on the same gate', async () => {
    const realm = await seedRealm('userinfo');
    const admin = await giveSubjectRole(realm, 'admin');
    await mapRoleToScope(realm, admin, 'roles');

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect((await userinfo(realm, accessToken)).roles).toEqual(['admin']);
  });

  it('withholds an unmapped role from userinfo too', async () => {
    const realm = await seedRealm('userinfo-unmapped');
    await giveSubjectRole(realm, 'admin'); // held, mapped to no scope

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    expect(await userinfo(realm, accessToken)).not.toHaveProperty('roles');
  });

  it('narrows a disabled full-scope client’s live token at userinfo', async () => {
    const realm = await seedRealm('userinfo-disabled-full-scope');
    await setFullScopeAllowed(realm);
    await giveSubjectRole(realm, 'admin'); // held, mapped to no scope, but full_scope_allowed

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    await disableClient(realm);

    expect(await userinfo(realm, accessToken)).not.toHaveProperty('roles');
  });

  it('lets a mapper claim overwrite no registered claim', async () => {
    const realm = await seedRealm('claim-order');
    const admin = await giveSubjectRole(realm, 'admin');
    await mapRoleToScope(realm, admin, 'roles');

    const { accessToken } = await completeCodeFlow(realm, 'openid roles');
    const payload = decode(accessToken);
    expect(payload.sub).toBe(realm.subjectId);
    expect(payload.iss).toContain(realm.realmName);
  });

  it('reaches the ID token when the scope says so, not just when it is withheld', async () => {
    const realm = await seedRealm('id-token-positive');

    // `profile`'s `include_in_id_token` default is true (unlike `roles`),
    // so its claim must actually land — the `roles`/`groups` tests above
    // only prove the gate can withhold, never that it lets a claim through.
    const { idToken } = await completeCodeFlow(realm, 'openid profile');
    if (idToken === undefined) throw new Error('expected an id_token');
    expect(decode(idToken).name).toBe(`alice-id-token-positive`);
  });

  it('withholds profile and email from the access token by default', async () => {
    const realm = await seedRealm('access-token-pii-default');

    const { accessToken } = await completeCodeFlow(realm, 'openid profile email');
    const payload = decode(accessToken);
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('email_verified');
  });

  it('carries sub on the access token regardless of the openid scope’s access-token flag', async () => {
    const realm = await seedRealm('access-token-sub-always');

    const { accessToken } = await completeCodeFlow(realm, 'openid');
    expect(decode(accessToken).sub).toBe(realm.subjectId);
  });

  it('lets profile reach the access token once a realm opts it in', async () => {
    const realm = await seedRealm('access-token-pii-opt-in');
    await setIncludeInAccessToken(realm, 'profile', true);

    const { accessToken } = await completeCodeFlow(realm, 'openid profile');
    expect(decode(accessToken).name).toBe('alice-access-token-pii-opt-in');
  });
});
