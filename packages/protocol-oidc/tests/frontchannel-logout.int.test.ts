import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
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
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

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
// through — proves a row like this cannot take logout down for the tenant.
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

// One tenant, one client for signing in, and a client per relying party
// spec — none of the RP clients need a redirect_uri of their own, since
// this file grants them a session-bound token_grants row directly rather
// than driving each one through a full authorization-code redemption; the
// join under test (token_grants -> client_oidc_config) does not care how
// the grant was minted.
async function setupTenant(
  name: string,
  rpSpecs: readonly RpClientSpec[],
): Promise<{ tenantId: string; subjectId: string; rpClientIds: Map<string, string> }> {
  const tenantId = newId();
  const loginClientDbId = newId();
  const rpClientIds = new Map<string, string>();

  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: loginClientDbId,
      tenantId,
      clientId: LOGIN_CLIENT_ID,
      name: 'Front-channel logout login client',
      type: 'confidential',
      secretHash: await hashPassword(LOGIN_CLIENT_SECRET),
    });
    await provisionClientDefaults(tx, loginClientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: loginClientDbId,
      tenantId,
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
        tenantId,
        clientId: spec.hostname,
        name: spec.hostname,
        type: 'confidential',
        secretHash: await hashPassword('unused-secret'),
        enabled: spec.enabled ?? true,
      });
      await provisionClientDefaults(tx, rpClientDbId);
      await clientOidcConfigRepository(tx).create({
        clientId: rpClientDbId,
        tenantId,
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

    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });

    const generated = await generateSigningKey('ES256', KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
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
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });

  const subjectId = await subjectIdOf(tenantId, USERNAME);
  return { tenantId, subjectId, rpClientIds };
}

async function subjectIdOf(tenantId: string, username: string): Promise<string> {
  const rows = await owner.db
    .select({ subjectId: users.subjectId })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.username, username)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no user ${username} in tenant ${tenantId}`);
  return row.subjectId;
}

async function issuerFor(tenantName: string): Promise<string> {
  const res = await http.inject({
    url: `/tenants/${tenantName}/.well-known/openid-configuration`,
  });
  return res.json<{ issuer: string }>().issuer;
}

async function mintIdToken(tenantName: string, sub: string, sid: string): Promise<string> {
  const key = signingKeyOf.get(tenantName);
  if (key === undefined) throw new Error(`no signing key for ${tenantName}`);
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: await issuerFor(tenantName),
      aud: LOGIN_CLIENT_ID,
      sub,
      iat: now,
      exp: now + 300,
      sid,
    },
    { key, kek: KEK },
  );
}

function authorizeUrl(tenantName: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: LOGIN_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${query.toString()}`;
}

function setCookieValue(res: LightMyRequestResponse): string | undefined {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return values.find((value) => !value.includes('-persistent='))?.split(';')[0];
}

function sessionIdFromCookie(cookie: string): string {
  const id = cookie.split('=')[1]?.split(':')[0];
  if (id === undefined) throw new Error('expected a session id in the cookie');
  return id;
}

async function signIn(tenantName: string): Promise<string> {
  const res = await http.inject({ url: authorizeUrl(tenantName) });
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
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(submitted.statusCode).toBe(302);
  const cookie = setCookieValue(submitted);
  if (cookie === undefined) throw new Error('expected a set-cookie header from a successful login');
  return cookie;
}

function logoutUrl(
  tenantName: string,
  idTokenHint: string,
  extra: Record<string, string> = {},
): string {
  const query = new URLSearchParams({ id_token_hint: idTokenHint, ...extra });
  return `/tenants/${tenantName}/protocol/openid-connect/logout?${query.toString()}`;
}

function frameUrl(body: string, hostname: string): URL {
  const match = new RegExp(`<iframe src="([^"]*${hostname}[^"]*)">`).exec(body);
  if (match?.[1] === undefined) throw new Error(`no iframe framing ${hostname} in ${body}`);
  // The src attribute is HTML-escaped (& -> &amp;); a real browser
  // unescapes it before treating it as a URL, so the test does the same.
  return new URL(match[1].replace(/&amp;/g, '&'));
}

async function grantUnderSession(
  tenantId: string,
  clientDbId: string,
  subjectId: string,
  sessionId: string | null,
): Promise<void> {
  await withTenant(app.db, tenantId, (tx) =>
    tokenGrantRepository(tx).create({
      id: newId(),
      tenantId,
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
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
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
    const tenantName = `frontchannel-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [
      RP_ONE,
      RP_TWO,
      RP_NO_FRONTCHANNEL,
      RP_NEVER_USED,
    ]);
    const cookie = await signIn(tenantName);
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

    await grantUnderSession(tenantId, rpOneId, subjectId, sessionId);
    await grantUnderSession(tenantId, rpTwoId, subjectId, sessionId);
    await grantUnderSession(tenantId, rpNoFrontchannelId, subjectId, sessionId);
    // Registered, but never granted under this session — proves the page
    // frames the session's own RPs, not every client the tenant has.
    await grantUnderSession(tenantId, rpNeverUsedId, subjectId, null);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(tenantName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).toContain('<iframe src="https://rp-two.example/logout?');
    // §2's own MUST: a client with no frontchannel_logout_uri is not framed.
    expect(res.body).not.toContain('rp-no-frontchannel.example');
    // Never granted under this session: named nowhere in the page.
    expect(res.body).not.toContain('rp-never-used.example');

    const withSession = frameUrl(res.body, 'rp-one.example');
    expect(withSession.searchParams.get('iss')).toBe(await issuerFor(tenantName));
    expect(withSession.searchParams.get('sid')).toBe(sessionId);

    const without = frameUrl(res.body, 'rp-two.example');
    expect(without.searchParams.get('iss')).toBe(await issuerFor(tenantName));
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
    const tenantName = `frontchannel-query-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [RP_THREE]);
    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpThreeId = rpClientIds.get(RP_THREE.hostname);
    if (rpThreeId === undefined) throw new Error('expected rp-three to have been provisioned');

    await grantUnderSession(tenantId, rpThreeId, subjectId, sessionId);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(tenantName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const url = frameUrl(res.body, 'rp-three.example');
    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.get('iss')).toBe(await issuerFor(tenantName));
  });

  it('[OIDC-FRONTCHANNEL-3-TRACKING-01] frames nothing, and carries no frame-src, when the session had no grants', async () => {
    const tenantName = `frontchannel-nogrants-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [RP_ONE]);
    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    if (rpOneId === undefined) throw new Error('expected rp-one to have been provisioned');

    // A second, unrelated login for the same subject, holding its own
    // grant for rp-one — proves the read is scoped to the session being
    // ended, not the tenant's, since a tenant-wide read of rp-one would
    // frame it regardless of which of the subject's sessions logs out.
    const otherCookie = await signIn(tenantName);
    await grantUnderSession(tenantId, rpOneId, subjectId, sessionIdFromCookie(otherCookie));

    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(tenantName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<iframe');
    expect(res.body).not.toContain('rp-one.example');
    expect(String(res.headers['content-security-policy'])).not.toContain('frame-src');
  });

  it('skips a stored frontchannel_logout_uri it cannot parse, rather than failing the whole logout', async () => {
    const tenantName = `frontchannel-malformed-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [
      RP_ONE,
      RP_MALFORMED,
    ]);
    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpMalformedId = rpClientIds.get(RP_MALFORMED.hostname);
    if (rpOneId === undefined || rpMalformedId === undefined) {
      throw new Error('expected both RP clients to have been provisioned');
    }
    await grantUnderSession(tenantId, rpOneId, subjectId, sessionId);
    await grantUnderSession(tenantId, rpMalformedId, subjectId, sessionId);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(tenantName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).not.toContain('rp-malformed.example');
  });

  it('does not frame a disabled client, even one that registered a front-channel logout URI', async () => {
    const tenantName = `frontchannel-disabled-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [
      RP_ONE,
      RP_DISABLED,
    ]);
    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);

    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    const rpDisabledId = rpClientIds.get(RP_DISABLED.hostname);
    if (rpOneId === undefined || rpDisabledId === undefined) {
      throw new Error('expected both RP clients to have been provisioned');
    }
    await grantUnderSession(tenantId, rpOneId, subjectId, sessionId);
    await grantUnderSession(tenantId, rpDisabledId, subjectId, sessionId);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    const res = await http.inject({ url: logoutUrl(tenantName, hint), headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');
    expect(res.body).not.toContain('rp-disabled.example');
    expect(String(res.headers['content-security-policy'])).not.toContain('rp-disabled.example');
  });

  it('[ODUDU-LOGOUT-REDIRECT-REFUSED-FRAME-01] also frames the session’s RPs when the redirect is refused', async () => {
    const tenantName = `frontchannel-refused-${newId()}`;
    const { tenantId, subjectId, rpClientIds } = await setupTenant(tenantName, [RP_ONE]);
    const cookie = await signIn(tenantName);
    const sessionId = sessionIdFromCookie(cookie);
    const rpOneId = rpClientIds.get(RP_ONE.hostname);
    if (rpOneId === undefined) throw new Error('expected rp-one to have been provisioned');

    await grantUnderSession(tenantId, rpOneId, subjectId, sessionId);

    const hint = await mintIdToken(tenantName, subjectId, sessionId);
    // LOGIN_CLIENT_ID registered no post_logout_redirect_uris at all, so
    // any value here is refused — this drives the render branch, not the
    // no-redirect `end` branch the earlier tests in this file drive.
    const res = await http.inject({
      url: logoutUrl(tenantName, hint, {
        client_id: LOGIN_CLIENT_ID,
        post_logout_redirect_uri: 'https://not-registered.example/after',
      }),
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('has not been used');
    expect(res.body).toContain('<iframe src="https://rp-one.example/logout?');

    const policy = String(res.headers['content-security-policy']);
    expect(policy).toContain('frame-src');
    expect(policy).toContain('https://rp-one.example');
  });
});
