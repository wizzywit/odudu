import { generateSigningKey, signingKeys, type SigningKeyRecord } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { provisionRealm, sessions } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { backchannelLogoutDeliveries } from '#/schema/logout-deliveries';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const LOGIN_CLIENT_ID = 'logout-enqueue-login-client';
const LOGIN_CLIENT_SECRET = 'logout-enqueue-login-client-secret';
const REDIRECT_URI = 'https://login-app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 31);

interface RpClientSpec {
  hostname: string;
  backchannelLogoutUri: string | null;
  enabled?: boolean;
}

const RP_ONE: RpClientSpec = {
  hostname: 'rp-one.example',
  backchannelLogoutUri: 'https://rp-one.example/backchannel',
};
const RP_NO_BACKCHANNEL: RpClientSpec = {
  hostname: 'rp-no-backchannel.example',
  backchannelLogoutUri: null,
};
const RP_NEVER_USED: RpClientSpec = {
  hostname: 'rp-never-used.example',
  backchannelLogoutUri: 'https://rp-never-used.example/backchannel',
};
const RP_DISABLED: RpClientSpec = {
  hostname: 'rp-disabled.example',
  backchannelLogoutUri: 'https://rp-disabled.example/backchannel',
  enabled: false,
};

// One realm, one client for signing in, and a client per relying party
// spec — mirrors frontchannel-logout.int.test.ts's setupRealm. A signing
// key is provisioned unless `withSigningKey` is false, which is how the
// transactional-failure test forces the realm to have none.
async function setupRealm(
  name: string,
  rpSpecs: readonly RpClientSpec[],
  { withSigningKey = true }: { withSigningKey?: boolean } = {},
): Promise<{ realmId: string; subjectId: string; rpClientIds: Map<string, string> }> {
  const realmId = newId();
  const loginClientDbId = newId();
  const rpClientIds = new Map<string, string>();

  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({ id: realmId, name });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: loginClientDbId,
      realmId,
      clientId: LOGIN_CLIENT_ID,
      name: 'Logout enqueue login client',
      type: 'confidential',
      secretHash: await hashPassword(LOGIN_CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, loginClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: loginClientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });

    for (const spec of rpSpecs) {
      const rpClientDbId = newId();
      await tx.insert(clients).values({
        id: rpClientDbId,
        realmId,
        clientId: spec.hostname,
        name: spec.hostname,
        type: 'confidential',
        secretHash: await hashPassword('unused-secret'),
        enabled: spec.enabled ?? true,
      });
      await provisionClientDefaults(tx, rpClientDbId);
      await clientOidcConfigRepository(tx).create({
        clientId: rpClientDbId,
        realmId,
        redirectUris: [`https://${spec.hostname}/callback`],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        backchannelLogoutUri: spec.backchannelLogoutUri,
      });
      rpClientIds.set(spec.hostname, rpClientDbId);
    }

    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });

    if (withSigningKey) {
      const generated = await generateSigningKey('ES256', KEK);
      const key: SigningKeyRecord = {
        id: newId(),
        realmId,
        kid: generated.kid,
        alg: generated.alg,
        status: 'active',
        publicJwk: generated.publicJwk,
        privateJwkEncrypted: generated.privateJwkEncrypted,
        createdAt: new Date(),
        notAfter: null,
      };
      await tx.insert(signingKeys).values({
        id: key.id,
        realmId,
        kid: key.kid,
        alg: key.alg,
        status: 'active',
        publicJwk: key.publicJwk,
        privateJwkEncrypted: key.privateJwkEncrypted,
      });
    }
  });

  const subjectId = await subjectIdOf(realmId, USERNAME);
  return { realmId, subjectId, rpClientIds };
}

async function subjectIdOf(realmId: string, username: string): Promise<string> {
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.realmId, realmId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in realm ${realmId}`);
  return row.subjectId;
}

function authorizeUrl(realmName: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: LOGIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  });
  return `/realms/${realmName}/protocol/openid-connect/auth?${query.toString()}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

async function signIn(realmName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(realmName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const authSessionId = match?.[1];
  if (authSessionId === undefined) throw new Error('auth_session_id not found');

  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const submitted = await http.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

async function grantUnderSession(
  realmId: string,
  clientDbId: string,
  subjectId: string,
  sessionId: string | null,
): Promise<void> {
  await withRealm(app.db, realmId, (tx) =>
    tokenGrantRepository(tx).create({
      id: newId(),
      realmId,
      clientId: clientDbId,
      subjectId,
      scope: 'openid',
      audience: [],
      sessionId,
    }),
  );
}

// Ends the session over the confirmation form's POST, which needs no
// `id_token_hint` (only the cookie and the hidden `session_id` field) — the
// transactional-failure test's realm carries no signing key, so minting one
// is not an option.
async function confirmLogout(realmName: string, cookie: string, sessionId: string) {
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/protocol/openid-connect/logout`,
    payload: new URLSearchParams({ session_id: sessionId }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
}

async function pendingFor(realmId: string): Promise<{ clientId: string; endpoint: string }[]> {
  const rows = await owner.db
    .select({ clientId: clients.clientId, endpoint: backchannelLogoutDeliveries.endpoint })
    .from(backchannelLogoutDeliveries)
    .innerJoin(clients, eq(clients.id, backchannelLogoutDeliveries.clientId))
    .where(eq(backchannelLogoutDeliveries.realmId, realmId));
  return rows;
}

async function sessionIsStillLive(sessionId: string): Promise<boolean> {
  const rows = await owner.db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  const row = rows[0];
  if (row === undefined) throw new Error(`no session row for ${sessionId}`);
  return row.expiresAt.getTime() > Date.now();
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
  httpApp = http;
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
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('ending a session enqueues its back-channel deliveries', () => {
  it('[OIDC-BACKCHANNEL-2.3-01] enqueues one delivery per client that registered a back-channel URI', async () => {
    const realmName = `logout-enqueue-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [
      RP_ONE,
      RP_NO_BACKCHANNEL,
      RP_NEVER_USED,
    ]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpNoBackchannelId = rpClientIds.get(RP_NO_BACKCHANNEL.hostname);
    const rpNeverUsedId = rpClientIds.get(RP_NEVER_USED.hostname);
    if (rpOneId === undefined || rpNoBackchannelId === undefined || rpNeverUsedId === undefined) {
      throw new Error('expected every RP client to have been provisioned');
    }

    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);
    await grantUnderSession(realmId, rpNoBackchannelId, subjectId, sessionId);
    // Registered, but never granted under this session.
    await grantUnderSession(realmId, rpNeverUsedId, subjectId, null);

    const res = await confirmLogout(realmName, cookie, sessionId);
    expect(res.statusCode).toBe(200);

    expect(await pendingFor(realmId)).toEqual([
      { clientId: RP_ONE.hostname, endpoint: RP_ONE.backchannelLogoutUri },
    ]);
  });

  it('enqueues nothing for a client that registered no back-channel URI', async () => {
    const realmName = `logout-enqueue-none-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_NO_BACKCHANNEL]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpNoBackchannelId = rpClientIds.get(RP_NO_BACKCHANNEL.hostname);
    if (rpNoBackchannelId === undefined)
      throw new Error('expected the RP client to be provisioned');

    await grantUnderSession(realmId, rpNoBackchannelId, subjectId, sessionId);

    const res = await confirmLogout(realmName, cookie, sessionId);
    expect(res.statusCode).toBe(200);

    expect((await pendingFor(realmId)).map((d) => d.clientId)).not.toContain(
      RP_NO_BACKCHANNEL.hostname,
    );
  });

  it('enqueues nothing for a disabled client, even one that registered a back-channel URI', async () => {
    const realmName = `logout-enqueue-disabled-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_DISABLED]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpDisabledId = rpClientIds.get(RP_DISABLED.hostname);
    if (rpDisabledId === undefined) throw new Error('expected the disabled RP client to exist');

    await grantUnderSession(realmId, rpDisabledId, subjectId, sessionId);

    const res = await confirmLogout(realmName, cookie, sessionId);
    expect(res.statusCode).toBe(200);

    expect((await pendingFor(realmId)).map((d) => d.clientId)).not.toContain(RP_DISABLED.hostname);
  });

  it('enqueues in the same transaction that ends the session', async () => {
    const realmName = `logout-enqueue-tx-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_ONE], {
      withSigningKey: false,
    });
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    if (rpOneId === undefined) throw new Error('expected rp-one to be provisioned');

    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);

    // No active signing key exists for this realm, so minting the logout
    // token this delivery needs throws inside the same transaction that
    // would otherwise end the session.
    const res = await confirmLogout(realmName, cookie, sessionId);
    expect(res.statusCode).toBe(500);

    expect(await sessionIsStillLive(sessionId)).toBe(true);
    expect(await pendingFor(realmId)).toEqual([]);
  });

  it('enqueues nothing twice when logout is called twice', async () => {
    const realmName = `logout-enqueue-twice-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_ONE]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    if (rpOneId === undefined) throw new Error('expected rp-one to be provisioned');

    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);

    const first = await confirmLogout(realmName, cookie, sessionId);
    expect(first.statusCode).toBe(200);
    // The session is already dead, so the confirmation form's own CSRF
    // check refuses the second POST rather than ending it again.
    const second = await confirmLogout(realmName, cookie, sessionId);
    expect(second.statusCode).toBe(400);

    expect(await pendingFor(realmId)).toHaveLength(1);
  });
});
