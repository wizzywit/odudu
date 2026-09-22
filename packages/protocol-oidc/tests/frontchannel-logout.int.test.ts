import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
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
import { provisionRealm } from '@odudu/authn-flows';
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

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const LOGIN_CLIENT_ID = 'frontchannel-login-client';
const LOGIN_CLIENT_SECRET = 'frontchannel-login-client-secret';
const REDIRECT_URI = 'https://login-app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const KEK = Buffer.alloc(32, 21);

interface RpClientSpec {
  hostname: string;
  frontchannelLogoutUri: string | null;
  frontchannelLogoutSessionRequired: boolean;
  enabled?: boolean;
}

const RP_ONE: RpClientSpec = {
  hostname: 'rp-one.example',
  frontchannelLogoutUri: 'https://rp-one.example/logout',
  frontchannelLogoutSessionRequired: true,
};
const RP_TWO: RpClientSpec = {
  hostname: 'rp-two.example',
  frontchannelLogoutUri: 'https://rp-two.example/logout',
  frontchannelLogoutSessionRequired: false,
};
const RP_THREE: RpClientSpec = {
  hostname: 'rp-three.example',
  frontchannelLogoutUri: 'https://rp-three.example/logout?tenant=a',
  frontchannelLogoutSessionRequired: false,
};
const RP_NO_FRONTCHANNEL: RpClientSpec = {
  hostname: 'rp-no-frontchannel.example',
  frontchannelLogoutUri: null,
  frontchannelLogoutSessionRequired: false,
};
const RP_NEVER_USED: RpClientSpec = {
  hostname: 'rp-never-used.example',
  frontchannelLogoutUri: 'https://rp-never-used.example/logout',
  frontchannelLogoutSessionRequired: false,
};
// Stored the way an operator's direct UPDATE could, bypassing the
// isValidLogoutUri check dynamic registration and seed client both go
// through — proves a row like this cannot take logout down for the realm.
const RP_MALFORMED: RpClientSpec = {
  hostname: 'rp-malformed.example',
  frontchannelLogoutUri: 'not a url at all',
  frontchannelLogoutSessionRequired: false,
};
const RP_DISABLED: RpClientSpec = {
  hostname: 'rp-disabled.example',
  frontchannelLogoutUri: 'https://rp-disabled.example/logout',
  frontchannelLogoutSessionRequired: false,
  enabled: false,
};

const signingKeyOf = new Map<string, SigningKeyRecord>();

// One realm, one client for signing in, and a client per relying party
// spec — none of the RP clients need a redirect_uri of their own, since
// this file grants them a session-bound token_grants row directly rather
// than driving each one through a full authorization-code redemption; the
// join under test (token_grants -> client_oidc_config) does not care how
// the grant was minted.
async function setupRealm(
  name: string,
  rpSpecs: readonly RpClientSpec[],
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
      name: 'Front-channel logout login client',
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
        frontchannelLogoutUri: spec.frontchannelLogoutUri,
        frontchannelLogoutSessionRequired: spec.frontchannelLogoutSessionRequired,
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
    signingKeyOf.set(name, key);
    await tx.insert(signingKeys).values({
      id: key.id,
      realmId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
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

async function issuerFor(realmName: string): Promise<string> {
  const res = await http.inject({
    url: `/realms/${realmName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(realmName: string, sub: string, sid: string): Promise<string> {
  const key = signingKeyOf.get(realmName);
  if (key === undefined) throw new Error(`no signing key for ${realmName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: await issuerFor(realmName),
      aud: LOGIN_CLIENT_ID,
      sub,
      iat: now,
      exp: now + 300,
      sid,
    },
    { key, kek: KEK },
  );
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

function logoutUrl(realmName: string, idTokenHint: string): string {
  const query = new URLSearchParams({ id_token_hint: idTokenHint });
  return `/realms/${realmName}/protocol/openid-connect/logout?${query.toString()}`;
}

function frameUrl(body: string, hostname: string): URL {
  const match = new RegExp(`<iframe src="([^"]*${hostname}[^"]*)">`).exec(body);
  if (match?.[1] === undefined) throw new Error(`no iframe framing ${hostname} in ${body}`);
  // The src attribute is HTML-escaped (& -> &amp;); a real browser
  // unescapes it before treating it as a URL, so the test does the same.
  return new URL(match[1].replace(/&amp;/g, '&'));
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

describe('the logout page frames each relying party that used the session', () => {
  it('[OIDC-FRONTCHANNEL-3-IFRAME-01] frames the front-channel logout URI of every client that used the session', async () => {
    const realmName = `frontchannel-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [
      RP_ONE,
      RP_TWO,
      RP_NO_FRONTCHANNEL,
      RP_NEVER_USED,
    ]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpTwoId = rpClientIds.get(RP_TWO.hostname);
    const rpNoFrontchannelId = rpClientIds.get(RP_NO_FRONTCHANNEL.hostname);
    const rpNeverUsedId = rpClientIds.get(RP_NEVER_USED.hostname);
    if (
      rpOneId === undefined ||
      rpTwoId === undefined ||
      rpNoFrontchannelId === undefined ||
      rpNeverUsedId === undefined
    ) {
      throw new Error('expected every RP client to have been provisioned');
    }

    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);
    await grantUnderSession(realmId, rpTwoId, subjectId, sessionId);
    await grantUnderSession(realmId, rpNoFrontchannelId, subjectId, sessionId);
    // Registered, but never granted under this session — proves the page
    // frames the session's own RPs, not every client the realm has.
    await grantUnderSession(realmId, rpNeverUsedId, subjectId, null);

    const hint = await mintIdToken(realmName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(realmName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).toContain('<iframe src="https://rp-two.example/logout?');
    // §2's own MUST: a client with no frontchannel_logout_uri is not framed.
    expect(res.body).not.toContain('rp-no-frontchannel.example');
    // Never granted under this session: named nowhere in the page.
    expect(res.body).not.toContain('rp-never-used.example');

    const withSession = frameUrl(res.body, 'rp-one.example');
    expect(withSession.searchParams.get('iss')).toBe(await issuerFor(realmName));
    expect(withSession.searchParams.get('sid')).toBe(sessionId);

    const without = frameUrl(res.body, 'rp-two.example');
    expect(without.searchParams.get('iss')).toBe(await issuerFor(realmName));
    expect(without.searchParams.has('sid')).toBe(false);

    const policy = String(res.headers['content-security-policy']);
    expect(policy).toContain('frame-src');
    const frameSrc = /frame-src ([^;]*)/.exec(policy)?.[1]?.split(' ') ?? [];
    expect(new Set(frameSrc)).toEqual(
      new Set(['https://rp-one.example', 'https://rp-two.example']),
    );
    expect(policy).not.toContain('rp-never-used.example');
    expect(policy).not.toContain('rp-no-frontchannel.example');
  });

  it('[OIDC-FRONTCHANNEL-2-QUERY-01] keeps a query component the client registered, and adds to it', async () => {
    const realmName = `frontchannel-query-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_THREE]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpThreeId = rpClientIds.get(RP_THREE.hostname);
    if (rpThreeId === undefined) throw new Error('expected rp-three to have been provisioned');

    await grantUnderSession(realmId, rpThreeId, subjectId, sessionId);

    const hint = await mintIdToken(realmName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(realmName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const url = frameUrl(res.body, 'rp-three.example');
    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.get('iss')).toBe(await issuerFor(realmName));
  });

  it('[OIDC-FRONTCHANNEL-3-TRACKING-01] frames nothing, and carries no frame-src, when the session had no grants', async () => {
    const realmName = `frontchannel-nogrants-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_ONE]);
    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    if (rpOneId === undefined) throw new Error('expected rp-one to have been provisioned');

    // A second, unrelated login for the same subject, holding its own
    // grant for rp-one — proves the read is scoped to the session being
    // ended, not the realm's, since a realm-wide read of rp-one would
    // frame it regardless of which of the subject's sessions logs out.
    const otherCookie = await signIn(realmName);
    await grantUnderSession(realmId, rpOneId, subjectId, sessionIdFromCookie(otherCookie));

    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const hint = await mintIdToken(realmName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(realmName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<iframe');
    expect(res.body).not.toContain('rp-one.example');
    expect(String(res.headers['content-security-policy'])).not.toContain('frame-src');
  });

  it('skips a stored frontchannel_logout_uri it cannot parse, rather than failing the whole logout', async () => {
    const realmName = `frontchannel-malformed-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_ONE, RP_MALFORMED]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpMalformedId = rpClientIds.get(RP_MALFORMED.hostname);
    if (rpOneId === undefined || rpMalformedId === undefined) {
      throw new Error('expected both RP clients to have been provisioned');
    }
    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);
    await grantUnderSession(realmId, rpMalformedId, subjectId, sessionId);

    const hint = await mintIdToken(realmName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(realmName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).not.toContain('rp-malformed.example');
  });

  it('does not frame a disabled client, even one that registered a front-channel logout URI', async () => {
    const realmName = `frontchannel-disabled-${newId()}`;
    const { realmId, subjectId, rpClientIds } = await setupRealm(realmName, [RP_ONE, RP_DISABLED]);
    const cookie = await signIn(realmName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpDisabledId = rpClientIds.get(RP_DISABLED.hostname);
    if (rpOneId === undefined || rpDisabledId === undefined) {
      throw new Error('expected both RP clients to have been provisioned');
    }
    await grantUnderSession(realmId, rpOneId, subjectId, sessionId);
    await grantUnderSession(realmId, rpDisabledId, subjectId, sessionId);

    const hint = await mintIdToken(realmName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(realmName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).not.toContain('rp-disabled.example');
    expect(String(res.headers['content-security-policy'])).not.toContain('rp-disabled.example');
  });
});
