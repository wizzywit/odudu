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
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionRealm, sessions } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

// The realm setting is the authority behind `remember_me`; the field in the
// login form body is only ever a request. These three cases are the whole
// of that gate: a realm that allows it honours a ticked box in the
// persistent cookie, an ordinary login never touches that cookie, and a
// realm that does not allow it ignores the field entirely — no matter what
// the browser sends.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'remember-me-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const REMEMBER_ME_MAX_SECONDS = 2_592_000;

async function setupRealm(name: string, rememberMeAllowed: boolean): Promise<string> {
  const realmId = newId();
  const clientDbId = newId();
  await withRealm(app.db, realmId, async (tx: RealmScopedDatabase) => {
    await tx.insert(realms).values({
      id: realmId,
      name,
      rememberMeAllowed,
      rememberMeMaxSeconds: REMEMBER_ME_MAX_SECONDS,
    });
    await provisionRealm(tx, realmId);
    await tx.insert(clients).values({
      id: clientDbId,
      realmId,
      clientId: CLIENT_ID,
      name: 'Remember-me test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      realmId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, realmId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      realmId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
  });
  return realmId;
}

function authorizeUrl(realmName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
  });
  return `/realms/${realmName}/protocol/openid-connect/auth?${params.toString()}`;
}

async function startAuthSession(realmName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(realmName) });
  if (res.statusCode !== 200) {
    throw new Error(`expected /authorize to render the login form, got ${String(res.statusCode)}`);
  }
  const match = /name="auth_session_id" value="([^"]*)"/.exec(res.body);
  const value = match?.[1];
  if (value === undefined) throw new Error('auth_session_id not found in the rendered login form');
  return value;
}

function cookieList(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

async function postLogin(
  realmName: string,
  extra: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const authSessionId = await startAuthSession(realmName);
  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
    ...extra,
  });
  return http.inject({
    method: 'POST',
    url: `/realms/${realmName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
}

async function rememberedFlagOf(cookieValue: string): Promise<boolean | undefined> {
  const sessionId = cookieValue.split('=')[1]?.split(';')[0];
  if (sessionId === undefined) throw new Error('expected a session id in the cookie value');
  const rows = await owner.db
    .select({ remembered: sessions.remembered })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return rows[0]?.remembered;
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
      kek: Buffer.alloc(32, 9),
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

describe('a realm that allows remembering', () => {
  it('carries a remembered login in the persistent cookie, with Max-Age', async () => {
    const realmName = `realm-${newId()}`;
    await setupRealm(realmName, true);

    const res = await postLogin(realmName, { remember_me: 'true' });

    expect(res.statusCode).toBe(302);
    const cookies = cookieList(res);
    const persistent = cookies.find((c) => c.includes('-session-persistent='));
    const ephemeral = cookies.find(
      (c) => c.startsWith(`${realmName}-session=`) && !c.includes('-persistent'),
    );
    if (persistent === undefined || ephemeral === undefined) {
      throw new Error(`expected both cookies, got: ${cookies.join(' | ')}`);
    }
    expect(persistent).toContain(`Max-Age=${String(REMEMBER_ME_MAX_SECONDS)}`);
    expect(ephemeral).toContain('Max-Age=0');
    expect(await rememberedFlagOf(persistent)).toBe(true);
  });

  it('carries an ordinary login in the ephemeral cookie, with no Max-Age', async () => {
    const realmName = `realm-${newId()}`;
    await setupRealm(realmName, true);

    const res = await postLogin(realmName);

    expect(res.statusCode).toBe(302);
    const cookies = cookieList(res);
    const ephemeral = cookies.find(
      (c) => c.startsWith(`${realmName}-session=`) && !c.includes('-persistent'),
    );
    if (ephemeral === undefined) {
      throw new Error(`expected an ephemeral cookie, got: ${cookies.join(' | ')}`);
    }
    expect(ephemeral).not.toContain('Max-Age');
    expect(await rememberedFlagOf(ephemeral)).toBe(false);
  });
});

describe('a realm that does not allow remembering', () => {
  it('refuses to remember a login even when the field asks for it', async () => {
    const realmName = `realm-${newId()}`;
    await setupRealm(realmName, false);

    const res = await postLogin(realmName, { remember_me: 'true' });

    expect(res.statusCode).toBe(302);
    const cookies = cookieList(res);
    const persistent = cookies.find((c) => c.includes('-session-persistent='));
    const ephemeral = cookies.find(
      (c) => c.startsWith(`${realmName}-session=`) && !c.includes('-persistent'),
    );
    if (persistent === undefined || ephemeral === undefined) {
      throw new Error(`expected both cookies, got: ${cookies.join(' | ')}`);
    }
    // The persistent cookie is still written — every login writes both —
    // but cleared, because nothing was added to that list.
    expect(persistent).toContain('Max-Age=0');
    expect(ephemeral).not.toContain('Max-Age');
    expect(await rememberedFlagOf(ephemeral)).toBe(false);
  });
});
