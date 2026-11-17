import { authenticationSessions, provisionTenant } from '@odudu/authn-flows';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { noBreachedLookup } from '#/testing/breached-check';

const CLIENT_ID = 'handle-client';
const REDIRECT_URI = 'https://app.example/callback';
const PASSWORD = 'correct horse battery staple';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;
let httpTls: FastifyInstance;

async function setupTenant(name: string): Promise<void> {
  const tenantId = newId();
  const clientDbId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name, maxSessionsPerBrowser: 10 });
    await provisionTenant(tx, tenantId);
    await tx.insert(clients).values({
      id: clientDbId,
      tenantId,
      clientId: CLIENT_ID,
      name: 'Handle client',
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
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
  });
}

function authorize(
  server: FastifyInstance,
  tenant: string,
  extra: Record<string, string> = {},
  cookie?: string,
): Promise<LightMyRequestResponse> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'the-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...extra,
  });
  return server.inject({
    url: `/tenants/${tenant}/protocol/openid-connect/auth?${query.toString()}`,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
}

function setCookies(res: LightMyRequestResponse): string[] {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

function formSession(res: LightMyRequestResponse): string {
  const id = /name="auth_session_id" value="([^"]*)"/u.exec(res.body)?.[1];
  if (id === undefined) throw new Error('no auth_session_id in the page');
  return id;
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  const make = async (tls: boolean): Promise<FastifyInstance> => {
    const server = Fastify();
    await server.register(formbody);
    await server.register(
      oidcRoutes({
        breachedPasswordCheck: noBreachedLookup,
        database: app,
        ownerDatabase: owner,
        kek: Buffer.alloc(32, 3),
        clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
        auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
        clientKeySet: NO_CLIENT_KEY_FETCHER,
        clock: new FakeClock(new Date()),
        tls,
      }),
    );
    await server.ready();
    return server;
  };
  http = await make(false);
  httpTls = await make(true);
}, 120_000);

afterAll(async () => {
  await http.close();
  await httpTls.close();
  await app.close();
  await owner.close();
  await container.stop();
});

describe('the login page parks the request on the browser', () => {
  it('sets a cookie naming the parked session, scoped to the tenant', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const res = await authorize(http, tenant);
    expect(res.statusCode).toBe(200);

    const [cookie, ...others] = setCookies(res);
    expect(others).toEqual([]);
    expect(cookie).toMatch(
      new RegExp(
        `^odudu-sign-in=${formSession(res)}\\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=/tenants/${tenant}/; Max-Age=1800$`,
        'u',
      ),
    );
  });

  it('keeps only a hash of the secret in the row', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const res = await authorize(http, tenant);
    const secret = /\.([A-Za-z0-9_-]{43});/u.exec(setCookies(res)[0] ?? '')?.[1] ?? '';
    const [row] = await owner.db
      .select()
      .from(authenticationSessions)
      .where(eq(authenticationSessions.id, formSession(res)));
    expect(row?.browserSecretHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('hands every request its own secret', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const first = setCookies(await authorize(http, tenant))[0];
    const second = setCookies(await authorize(http, tenant))[0];
    expect(first).not.toBe(second);
  });

  it('carries the Secure attribute and the __Secure- prefix under TLS', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const [cookie] = setCookies(await authorize(httpTls, tenant));
    expect(cookie).toMatch(/^__Secure-odudu-sign-in=/u);
    expect(cookie).toContain('; Secure;');
  });

  it('is set on the account chooser too, which a person may leave for the sign-in form', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const form = await authorize(http, tenant);
    const signedIn = await http.inject({
      method: 'POST',
      url: `/tenants/${tenant}/login-actions/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: formSession(form),
        username: 'ada',
        password: PASSWORD,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const session = setCookies(signedIn)
      .map((value) => value.split(';')[0] ?? '')
      .filter((pair) => !pair.endsWith('='))
      .join('; ');

    const chooser = await authorize(http, tenant, { prompt: 'select_account' }, session);
    expect(chooser.body).toContain('login-actions/select-account');
    const [cookie] = setCookies(chooser);
    expect(cookie).toContain(`odudu-sign-in=${formSession(chooser)}.`);
  });

  it('is not set when the request is refused before anything is parked', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const res = await authorize(http, tenant, { redirect_uri: 'https://elsewhere.example/cb' });
    expect(res.statusCode).toBe(400);
    expect(setCookies(res)).toEqual([]);
  });
});

describe('the sign-in handle is cleared when the sign-in completes', () => {
  it('expires the cookie beside the session on the success redirect, and not on a refusal', async () => {
    const tenant = `handle-${newId()}`;
    await setupTenant(tenant);
    const form = await authorize(http, tenant);
    const submit = (password: string) =>
      http.inject({
        method: 'POST',
        url: `/tenants/${tenant}/login-actions/authenticate`,
        payload: new URLSearchParams({
          auth_session_id: formSession(form),
          username: 'ada',
          password,
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });

    expect(setCookies(await submit('wrong'))).toEqual([]);
    const done = await submit(PASSWORD);
    expect(done.statusCode).toBe(302);
    expect(setCookies(done)).toContain(
      `odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/${tenant}/; Max-Age=0`,
    );
  });
});
