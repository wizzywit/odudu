import { sessions } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { subjectRepository, userRepository } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository } from '@odudu/domain-tenant';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// The freshness gate through the real app: a sign-in made through /authorize,
// an access token for the session it opened, and the gated "me" calls.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const REDIRECT = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple 1!';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const WINDOW_SECONDS = 300;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
}

async function world(): Promise<World> {
  const name = `meg-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT],
    username: 'ada',
    password: PASSWORD,
    email: 'ada@example.com',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  await withTenant(appDb.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId('portal');
    if (client === null) throw new Error('no client');
    for (const scope of await clientScopeRepository(tx).byNames(['me:read', 'me:write'])) {
      await clientScopeRepository(tx).assign(client.id, scope.id, 'optional');
    }
  });
  await owner.sql`
    update client_oidc_config set audiences = ${[meAudienceOfIssuer(`${BASE}/tenants/${name}`)]}
     where tenant_id = ${tenantId}
       and client_id in (select id from clients where tenant_id = ${tenantId} and client_id = 'portal')`;
  return { name, tenantId, issuer: `${BASE}/tenants/${name}`, subjectId: seeded.userSubjectId };
}

function authorizeUrl(w: World, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'portal',
    redirect_uri: REDIRECT,
    scope: 'openid me:read me:write',
    resource: meAudienceOfIssuer(w.issuer),
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return `/tenants/${w.name}/protocol/openid-connect/auth?${query.toString()}`;
}

const authorize = (w: World, extra: Record<string, string> = {}, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: authorizeUrl(w, extra),
    headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) },
  });

const rendersLoginForm = (res: LightMyRequestResponse) =>
  res.statusCode === 200 && res.body.includes('auth_session_id');

function authSessionIdOf(res: LightMyRequestResponse): string {
  const value = /name="auth_session_id" value="([^"]*)"/.exec(res.body)?.[1];
  if (value === undefined) throw new Error('no login form');
  return value;
}

function sessionCookieOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const cookie = values.find((value) => !value.includes('-persistent='))?.split(';')[0];
  if (cookie === undefined) throw new Error('no session cookie');
  return cookie;
}

function codeOf(res: LightMyRequestResponse): string {
  const location = res.headers.location;
  const code = typeof location === 'string' ? new URL(location).searchParams.get('code') : null;
  if (code === null) throw new Error(`no code in the redirect: ${String(res.statusCode)}`);
  return code;
}

// Submits the credentials of the login form `form` rendered; the answer is the
// redirect back to the client, carrying a code and the new session's cookie.
function submitPassword(w: World, form: LightMyRequestResponse) {
  return app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/login-actions/authenticate`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      auth_session_id: authSessionIdOf(form),
      username: 'ada',
      password: PASSWORD,
    }).toString(),
  });
}

async function signIn(
  w: World,
  extra: Record<string, string> = {},
  cookie?: string,
): Promise<{ cookie: string; code: string }> {
  const form = await authorize(w, extra, cookie);
  if (!rendersLoginForm(form))
    throw new Error(
      `expected a login form: ${String(form.statusCode)} ${String(form.headers.location)}`,
    );
  const done = await submitPassword(w, form);
  expect(done.statusCode).toBe(302);
  return { cookie: sessionCookieOf(done), code: codeOf(done) };
}

async function exchange(w: World, code: string): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${w.name}/protocol/openid-connect/token`,
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'portal',
      code,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    }).toString(),
  });
  expect(res.statusCode).toBe(200);
  return res.json<Record<string, unknown>>();
}

const sessionIdOf = (cookie: string): string => {
  const id = cookie.split('=')[1]?.split(':')[0];
  if (id === undefined) throw new Error('no session id in the cookie');
  return id;
};

function claimsOf(token: unknown): Record<string, unknown> {
  const segment = typeof token === 'string' ? token.split('.')[1] : undefined;
  if (segment === undefined) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const sessionRow = async (id: string) =>
  (await owner.db.select().from(sessions).where(eq(sessions.id, id)))[0];

async function backdate(sessionId: string, seconds: number): Promise<void> {
  const row = await sessionRow(sessionId);
  if (row === undefined) throw new Error('no session');
  await owner.db
    .update(sessions)
    .set({ createdAt: new Date(row.createdAt.getTime() - seconds * 1000) })
    .where(eq(sessions.id, sessionId));
}

async function sign(w: World, sid: string | undefined): Promise<string> {
  const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'portal',
      ...(sid === undefined ? {} : { sid }),
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

const callMe = (w: World, method: 'PATCH' | 'DELETE', path: string, token: string, body?: object) =>
  app.inject({
    method,
    url: `/tenants/${w.name}/me/${path}`,
    headers: { host: HOST, authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body }),
  });

const CHALLENGE_HEADER =
  `Bearer error="insufficient_user_authentication", error_description="A recent sign-in is ` +
  `required", max_age="${String(WINDOW_SECONDS)}"`;

describe('/authorize against a session that is already live', () => {
  it('reuses the session when nothing asks for a new sign-in', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    const res = await authorize(w, {}, cookie);
    expect(res.statusCode).toBe(302);
    expect(codeOf(res)).toBeTruthy();
  });

  it('forces a new sign-in for max_age=0', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    expect(rendersLoginForm(await authorize(w, { max_age: '0' }, cookie))).toBe(true);
  });

  it('forces a new sign-in for prompt=login', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    expect(rendersLoginForm(await authorize(w, { prompt: 'login' }, cookie))).toBe(true);
  });

  it('reuses a session younger than max_age and renews one that is older', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    const sessionId = sessionIdOf(cookie);
    expect((await authorize(w, { max_age: String(WINDOW_SECONDS) }, cookie)).statusCode).toBe(302);
    await backdate(sessionId, WINDOW_SECONDS + 60);
    const aged = await authorize(w, { max_age: String(WINDOW_SECONDS) }, cookie);
    expect(rendersLoginForm(aged)).toBe(true);
  });
});

describe('the gate, with a token for a session the sign-in opened', () => {
  it('takes auth_time from the session, which the token names by sid', async () => {
    const w = await world();
    const { cookie, code } = await signIn(w, { max_age: '3600' });
    const tokens = await exchange(w, code);
    const access = claimsOf(tokens.access_token);
    expect(access.sid).toBe(sessionIdOf(cookie));
    expect(access.scope).toContain('me:write');
    const row = await sessionRow(sessionIdOf(cookie));
    expect(claimsOf(tokens.id_token).auth_time).toBe(
      Math.floor((row?.createdAt.getTime() ?? 0) / 1000),
    );
  });

  it('lets a gated call through on a recent sign-in', async () => {
    const w = await world();
    const { code } = await signIn(w);
    const token = String((await exchange(w, code)).access_token);
    const res = await callMe(w, 'DELETE', 'sessions', token);
    expect(res.statusCode).toBe(200);
  });

  it('asks for a new sign-in once the session is older than the window, then accepts the new token', async () => {
    const w = await world();
    const first = await signIn(w);
    const oldToken = String((await exchange(w, first.code)).access_token);
    await backdate(sessionIdOf(first.cookie), WINDOW_SECONDS + 60);

    const refused = await callMe(w, 'DELETE', 'sessions', oldToken);
    expect(refused.statusCode).toBe(401);
    expect(refused.headers['www-authenticate']).toBe(CHALLENGE_HEADER);

    const second = await signIn(w, { max_age: String(WINDOW_SECONDS) }, first.cookie);
    expect(sessionIdOf(second.cookie)).not.toBe(sessionIdOf(first.cookie));
    const renewed = await sessionRow(sessionIdOf(second.cookie));
    expect(Date.now() - (renewed?.createdAt.getTime() ?? 0)).toBeLessThan(60_000);

    const newToken = String((await exchange(w, second.code)).access_token);
    expect((await callMe(w, 'DELETE', 'sessions', newToken)).statusCode).toBe(200);
  });

  it('refuses without a challenge when the session behind the token has ended', async () => {
    const w = await world();
    await owner.sql`update tenants set username_editable = true where id = ${w.tenantId}`;
    const { cookie } = await signIn(w);
    const token = await sign(w, sessionIdOf(cookie));
    await owner.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionIdOf(cookie)));

    for (const [method, path, body] of [
      ['DELETE', 'sessions', undefined],
      ['DELETE', 'consents/portal', undefined],
      ['PATCH', 'profile', { username: 'ada2' }],
    ] as const) {
      const res = await callMe(w, method, path, token, body);
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    }
  });

  it('refuses without a challenge for a token that names no session', async () => {
    const w = await world();
    const res = await callMe(w, 'DELETE', 'sessions', await sign(w, undefined));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
  });

  it('leaves the changes that are not gated alone, however old the sign-in', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    await backdate(sessionIdOf(cookie), 10 * WINDOW_SECONDS);
    const token = await sign(w, sessionIdOf(cookie));
    expect((await callMe(w, 'PATCH', 'profile', token, { name: 'Ada L' })).statusCode).toBe(200);
  });
});

describe('PATCH /me/profile, a username', () => {
  it('is refused where the tenant does not let a username change', async () => {
    const w = await world();
    const { cookie } = await signIn(w);
    const res = await callMe(w, 'PATCH', 'profile', await sign(w, sessionIdOf(cookie)), {
      username: 'ada2',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('username_editable');
  });

  it('renames the person on a recent sign-in where the tenant allows it, and answers 409 for a held name', async () => {
    const w = await world();
    await owner.sql`update tenants set username_editable = true where id = ${w.tenantId}`;
    const { cookie } = await signIn(w);
    const token = await sign(w, sessionIdOf(cookie));

    const renamed = await callMe(w, 'PATCH', 'profile', token, { username: 'ada2' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ username: 'ada2' });
    const user = await withTenant(appDb.db, w.tenantId, (tx) =>
      userRepository(tx).bySubjectId(w.subjectId),
    );
    expect(user?.username).toBe('ada2');

    await withTenant(appDb.db, w.tenantId, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' });
      await userRepository(tx).create({
        subjectId: other.id,
        tenantId: w.tenantId,
        username: 'grace',
        email: 'grace@example.com',
      });
    });
    const held = await callMe(w, 'PATCH', 'profile', token, { username: 'grace' });
    expect(held.statusCode).toBe(409);
  });

  it('is gated: an old sign-in is asked for a new one and nothing changes', async () => {
    const w = await world();
    await owner.sql`update tenants set username_editable = true where id = ${w.tenantId}`;
    const { cookie } = await signIn(w);
    await backdate(sessionIdOf(cookie), WINDOW_SECONDS + 60);
    const res = await callMe(w, 'PATCH', 'profile', await sign(w, sessionIdOf(cookie)), {
      username: 'ada2',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(CHALLENGE_HEADER);
    const user = await withTenant(appDb.db, w.tenantId, (tx) =>
      userRepository(tx).bySubjectId(w.subjectId),
    );
    expect(user?.username).toBe('ada');
  });
});

describe('the window is the tenant’s', () => {
  it('names the tenant’s own figure and applies it', async () => {
    const w = await world();
    await owner.sql`update tenants set session_freshness_seconds = 60 where id = ${w.tenantId}`;
    const { cookie } = await signIn(w);
    await backdate(sessionIdOf(cookie), 90);
    const res = await callMe(w, 'DELETE', 'sessions', await sign(w, sessionIdOf(cookie)));
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('max_age="60"');
  });
});
