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
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenant, SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';

const TENANT_LIFESPANS = {
  ssoSessionIdleSeconds: 1_800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

// ADR 0033: a browser may hold at most `max_sessions_per_browser` live
// sessions, enforced by admitSession's tenant-row lock so two concurrent
// admissions cannot both see room under the cap. This is the end-to-end
// proof: a browser that logs in more times than the cap ends with exactly
// the cap's worth of live sessions, and the cookies it is sent name
// exactly those — nothing evicted is left behind in either list.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const CLIENT_ID = 'session-cap-client';
const REDIRECT_URI = 'https://app.example/callback';
const USERNAME = 'ada';
const PASSWORD = 'correct horse battery staple';
const CAP = 2;

async function setupTenant(name: string): Promise<{ tenantId: string; subjectId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  let subjectId = '';
  await withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name, maxSessionsPerBrowser: CAP });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Session cap test client',
      type: 'public',
    });
    await provisionClientDefaults(tx, clientDbId);
    await clientOidcConfigRepository(tx).create({
      clientId: clientDbId,
      tenantId,
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
    });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    subjectId = subject.id;
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: USERNAME });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
  });
  return { tenantId, subjectId };
}

function authorizeUrl(tenantName: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'xyz',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    // Forces the form even though this browser already holds a live SSO
    // session — a repeat visit that reused it would never submit
    // credentials again, and this test needs every one of its logins to.
    prompt: 'login',
  });
  return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
}

async function startAuthSession(tenantName: string, cookie: string): Promise<string> {
  const res = await http.inject({
    url: authorizeUrl(tenantName),
    headers: cookie.length > 0 ? { cookie } : {},
  });
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

// A real browser merges each Set-Cookie's name=value pair into the Cookie
// header of its next request. Only the two session cookies matter here.
function mergeCookies(existing: Map<string, string>, res: LightMyRequestResponse): void {
  for (const set of cookieList(res)) {
    const pair = set.split(';')[0];
    const eq = pair?.indexOf('=');
    if (pair === undefined || eq === undefined || eq === -1) continue;
    existing.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

// The ephemeral session-cookie ids a single response set, as opposed to
// what survives in the jar after every response has overwritten the last —
// an evicted id shows up here even though mergeCookies has since replaced
// it with whatever the next login wrote.
function ephemeralIdsSet(tenantName: string, res: LightMyRequestResponse): string[] {
  const name = `${tenantName}-session=`;
  const value = cookieList(res)
    .find((set) => set.startsWith(name))
    ?.split(';')[0]
    ?.slice(name.length);
  return value === undefined ? [] : value.split('.').filter((id) => id.length > 0);
}

async function login(
  tenantName: string,
  jar: Map<string, string>,
): Promise<LightMyRequestResponse> {
  const authSessionId = await startAuthSession(tenantName, cookieHeader(jar));
  const form = new URLSearchParams({
    auth_session_id: authSessionId,
    username: USERNAME,
    password: PASSWORD,
  });
  const res = await http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/login-actions/authenticate`,
    payload: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookieHeader(jar).length > 0 ? { cookie: cookieHeader(jar) } : {}),
    },
  });
  expect(res.statusCode).toBe(302);
  mergeCookies(jar, res);
  return res;
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

describe('the session cap, end to end', () => {
  it('holds max_sessions_per_browser across repeated logins, with no evicted id left in a cookie', async () => {
    const tenantName = `tenant-${newId()}`;
    const { tenantId } = await setupTenant(tenantName);

    const jar = new Map<string, string>();
    // Two logins past the cap: enough that a broken cap — every id ever
    // issued kept in the cookie, or the tenant-row lock missing so a race
    // slips one extra past eviction — would show up as more than CAP ids
    // below.
    const everyIssuedId = new Set<string>();
    for (let i = 0; i < CAP + 2; i++) {
      const res = await login(tenantName, jar);
      for (const id of ephemeralIdsSet(tenantName, res)) everyIssuedId.add(id);
    }

    const ephemeral = jar.get(`${tenantName}-session`);
    if (ephemeral === undefined) throw new Error('expected an ephemeral cookie in the jar');
    const finalIds = ephemeral.split('.').filter((id) => id.length > 0);
    expect(finalIds).toHaveLength(CAP);
    expect(new Set(finalIds).size).toBe(CAP);

    // The final cookie alone would pass even if an evicted id were still
    // live: querying only the ids that happened to survive the last
    // response cannot see one the database still holds. The union of every
    // id any response ever issued is what actually proves the cap —
    // sequential logins from one browser converge on exactly the cap
    // across every id ever handed out, not just the last one kept.
    const allIssuedIds = [...everyIssuedId];
    expect(allIssuedIds.length).toBeGreaterThan(CAP);

    const now = new Date();
    await withTenant(app.db, tenantId, async (tx) => {
      const entries = allIssuedIds
        .map((value) => SessionEntry.parse(value))
        .filter((entry) => entry !== null);
      expect(entries).toHaveLength(allIssuedIds.length);
      const live = await sessionRepository(tx).liveByEntries(entries, TENANT_LIFESPANS, now);
      expect(live).toHaveLength(CAP);
      expect(live.map((session) => session.entry.cookieValue()).sort()).toEqual(
        [...finalIds].sort(),
      );
    });
  });
});
