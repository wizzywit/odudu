import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { requiredActionRepository, type RequiredAction } from '@odudu/authn-flows';
import { totpCode, totpCounter } from '@odudu/crypto';
import { hostState, tenantDomainRepository } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type ThrottleSettings } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { CONSOLE_KEYS } from '#/testing/console-key';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A verified domain serves its tenant at the root, and nothing else does:
// the host selects a tenant only through a verified, live row.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
const apps: FastifyInstance[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const BASE_HOST = 'id.example.com';
const REDIRECT_URI = 'https://app.example/callback';
const LOGOUT_URI = 'https://app.example/signed-out';
const SPA_ORIGIN = 'https://spa.example';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different horse, battery and staple';
const FORM = 'application/x-www-form-urlencoded';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
}, 120_000);

afterAll(async () => {
  for (const app of apps) await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface Stack {
  app: FastifyInstance;
  lookups: string[];
}

interface StartOptions {
  publicBaseUrl?: string | undefined;
  trustProxy?: boolean;
  throttle?: ThrottleSettings;
  loginThrottle?: ThrottleSettings;
  extra?: Partial<Parameters<typeof buildApp>[0]>;
}

async function start(options: StartOptions = {}): Promise<Stack> {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const lookups: string[] = [];
  const publicBaseUrl = 'publicBaseUrl' in options ? options.publicBaseUrl : BASE;
  const app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    tls: true,
    ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
    trustProxy: options.trustProxy ?? false,
    throttle: options.throttle ?? { limit: 100_000, windowSeconds: 60 },
    ...(options.loginThrottle === undefined ? {} : { loginThrottle: options.loginThrottle }),
    hostState: (host) => {
      lookups.push(host);
      return hostState(owner.db, host, new Date());
    },
    ...options.extra,
  });
  await app.ready();
  apps.push(app);
  return { app, lookups };
}

interface Tenant {
  name: string;
  id: string;
  username: string;
  subjectId: string;
}

async function newTenant(): Promise<Tenant> {
  const name = `dom-${newId()}`;
  const username = `u${newId().slice(-8)}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: [REDIRECT_URI],
    username,
    password: PASSWORD,
  });
  await seed([
    'client',
    '--tenant',
    name,
    '--client-id',
    'consenter',
    '--public',
    '--redirect-uri',
    REDIRECT_URI,
    '--post-logout-redirect-uri',
    LOGOUT_URI,
    '--web-origin',
    SPA_ORIGIN,
    '--consent-required',
  ]);
  await seed([
    'client',
    '--tenant',
    name,
    '--client-id',
    'spa',
    '--public',
    '--redirect-uri',
    REDIRECT_URI,
    '--web-origin',
    SPA_ORIGIN,
  ]);
  if (seeded.userSubjectId === undefined) throw new Error('the seed made no user');
  return { name, id: seeded.tenantId, username, subjectId: seeded.userSubjectId };
}

type DomainKind = 'canonical' | 'idle' | 'pending' | 'failed';

let hostCounter = 0;
const freshHost = (): string => `d${String((hostCounter += 1))}.login-tests.net`;

async function addDomain(tenant: Tenant, kind: DomainKind, host = freshHost()): Promise<string> {
  await withTenant(appDb.db, tenant.id, async (tx) => {
    const domains = tenantDomainRepository(tx);
    const row = await domains.insert({ tenantId: tenant.id, host, challenge: 'c' });
    if (kind === 'pending') return;
    if (kind === 'failed') {
      await domains.markFailed(tenant.id, row.id);
      return;
    }
    await domains.markVerified(tenant.id, row.id, new Date());
    if (kind === 'canonical') await domains.setCanonical(tenant.id, row.id);
  });
  return host;
}

async function owe(tenant: Tenant, actions: RequiredAction[]): Promise<void> {
  await withTenant(appDb.db, tenant.id, async (tx) => {
    for (const action of actions) {
      await requiredActionRepository(tx).add(tenant.id, tenant.subjectId, action);
    }
  });
}

class Browser {
  readonly cookies = new Map<string, string>();
  readonly seen: string[][] = [];

  readonly app: FastifyInstance;
  readonly host: string;
  private readonly extra: Record<string, string>;

  constructor(app: FastifyInstance, host: string, extra: Record<string, string> = {}) {
    this.app = app;
    this.host = host;
    this.extra = extra;
  }

  private absorb(res: LightMyRequestResponse): void {
    const raw = res.headers['set-cookie'];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    this.seen.push(list);
    for (const line of list) {
      const [pair = '', ...attributes] = line.split('; ');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '' || attributes.includes('Max-Age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
  }

  async send(
    method: 'GET' | 'POST' | 'OPTIONS',
    url: string,
    options: { form?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      headers: {
        host: this.host,
        ...this.extra,
        ...this.cookieHeader(),
        ...(options.form === undefined ? {} : { 'content-type': FORM }),
        ...options.headers,
      },
      ...(options.form === undefined
        ? {}
        : { payload: new URLSearchParams(options.form).toString() }),
    });
    this.absorb(res);
    return res;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.send('GET', url, headers === undefined ? {} : { headers });
  }

  post(url: string, form: Record<string, string>, headers?: Record<string, string>) {
    return this.send('POST', url, { form, ...(headers === undefined ? {} : { headers }) });
  }
}

const unescape = (text: string): string => text.replaceAll('&amp;', '&').replaceAll('&#39;', "'");

function targets(body: string): string[] {
  return [...body.matchAll(/(?:action|href)="([^"]*)"/gu)].map((m) => unescape(m[1] ?? ''));
}

function firstForm(body: string): { action: string; fields: Record<string, string> } {
  const action = /<form[^>]*\saction="([^"]*)"/u.exec(body)?.[1];
  if (action === undefined) throw new Error(`no form on the page: ${body.slice(0, 300)}`);
  const fields: Record<string, string> = {};
  for (const m of body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/gu)) {
    fields[m[1] ?? ''] = unescape(m[2] ?? '');
  }
  return { action: unescape(action), fields };
}

function authorizeQuery(clientId: string): string {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 's',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  }).toString();
}

const authorizeUrl = (prefix: string, clientId: string): string =>
  `${prefix}/protocol/openid-connect/auth?${authorizeQuery(clientId)}`;

const comparable = (res: LightMyRequestResponse) => {
  const headers = { ...res.headers };
  Reflect.deleteProperty(headers, 'date');
  Reflect.deleteProperty(headers, 'x-request-id');
  return { status: res.statusCode, headers, body: res.body };
};

describe('a verified canonical domain', () => {
  it('serves the protocol as its tenant and states its own origin as the issuer', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const browser = new Browser(app, host);

    const res = await browser.get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(200);
    const doc = res.json<Record<string, unknown>>();
    expect(doc.issuer).toBe(`https://${host}`);
    expect(doc.authorization_endpoint).toBe(`https://${host}/protocol/openid-connect/auth`);
    for (const value of Object.values(doc)) {
      if (typeof value === 'string' && value.startsWith('http')) {
        expect(value.startsWith(`https://${host}/`) || value === `https://${host}`).toBe(true);
      }
    }
    expect(res.body).not.toContain('/tenants/');
    expect(res.body).not.toContain(BASE_HOST);

    const page = await browser.get(authorizeUrl('', 'portal'));
    expect(page.statusCode).toBe(200);
    expect(firstForm(page.body).action).toBe('/login-actions/authenticate');
  });

  it('reads the host in any spelling of it', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const spelled = `${host.toUpperCase()}.:443`;
    const res = await new Browser(app, spelled).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ issuer: string }>().issuer).toBe(`https://${host}`);
  });

  it('serves a domain whose issuer is still inside its retirement window', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'idle');
    await withTenant(appDb.db, tenant.id, (tx) =>
      tenantDomainRepository(tx).retireIssuer(
        tenant.id,
        `https://${host}`,
        new Date(Date.now() + 3_600_000),
      ),
    );
    const res = await new Browser(app, host).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(200);
  });

  it('refuses what the tenant does not serve, and serves health to any host', async () => {
    const { app, lookups } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const browser = new Browser(app, host);
    for (const path of [
      `/tenants/${tenant.name}/.well-known/openid-configuration`,
      '/admin/tenants',
      '/console/',
      '/docs',
      '/internal/other',
      '/metrics',
    ]) {
      const res = await browser.get(path);
      expect(res.statusCode, path).toBe(404);
      expect(res.body, path).not.toContain('"issuer"');
    }
    const before = lookups.length;
    expect((await browser.get('/health/live')).statusCode).toBe(200);
    expect(lookups.length).toBe(before);
  });
});

describe('a host that is registered and not live', () => {
  it('answers every path in the same empty bytes, whatever the reason', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const disabled = await newTenant();
    const hosts = [
      await addDomain(tenant, 'pending'),
      await addDomain(tenant, 'failed'),
      await addDomain(tenant, 'idle'),
      await addDomain(disabled, 'canonical'),
    ];
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, disabled.id));
    const paths = [
      '/.well-known/openid-configuration',
      '/protocol/openid-connect/auth',
      `/tenants/${tenant.name}/.well-known/openid-configuration`,
      '/admin/x',
      '/',
    ];
    const answers = [];
    for (const host of hosts) {
      for (const path of paths) {
        answers.push(comparable(await new Browser(app, host).get(path)));
      }
    }
    const [first] = answers;
    expect(first).toMatchObject({ status: 404, body: '' });
    for (const answer of answers) expect(answer).toEqual(first);
  });

  it('is refused in the same bytes on a POST', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'pending');
    const refused = await new Browser(app, host).post('/login-actions/authenticate', {
      username: 'x',
    });
    const get = await new Browser(app, host).get('/anything');
    expect(comparable(refused)).toEqual(comparable(get));
  });
});

describe('a host nobody registered', () => {
  it('is routed as it was before domains, and selects no tenant', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const browser = new Browser(app, 'nobody.login-tests.net');
    const doc = await browser.get(`/tenants/${tenant.name}/.well-known/openid-configuration`);
    expect(doc.statusCode).toBe(200);
    expect(doc.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${tenant.name}`);
    expect((await browser.get('/.well-known/openid-configuration')).statusCode).toBe(404);
    expect((await browser.get('/protocol/openid-connect/auth')).statusCode).toBe(404);
  });

  it('is looked up once, and an address or the base host not at all', async () => {
    const { app, lookups } = await start();
    const tenant = await newTenant();
    await new Browser(app, 'nobody.login-tests.net').get('/health/ready');
    expect(lookups).toEqual([]);
    expect((await new Browser(app, '127.0.0.1').get('/health/ready')).statusCode).toBe(200);
    expect(
      (
        await new Browser(app, BASE_HOST).get(
          `/tenants/${tenant.name}/.well-known/openid-configuration`,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await new Browser(app, 'ID.example.com:443').get(`/tenants/${tenant.name}/jwks`)).statusCode,
    ).toBeLessThan(500);
    expect(lookups).toEqual([]);
    await new Browser(app, 'nobody.login-tests.net').get(`/tenants/${tenant.name}/jwks`);
    expect(lookups).toEqual(['nobody.login-tests.net']);
  });
});

describe('which header names the host', () => {
  it('ignores X-Forwarded-Host while the proxy is not trusted', async () => {
    const { app } = await start({ trustProxy: false });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, 'evil.login-tests.net', { 'x-forwarded-host': host }).get(
      '/.well-known/openid-configuration',
    );
    expect(res.statusCode).toBe(404);
  });

  it('follows the last X-Forwarded-Host entry once it is, not one the client prepended', async () => {
    const { app } = await start({ trustProxy: true });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, 'internal.login-tests.net', {
      'x-forwarded-host': `spoof.login-tests.net, ${host}`,
    }).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ issuer: string }>().issuer).toBe(`https://${host}`);
  });
});

describe('a client that writes the forwarded host itself', () => {
  it('is not served as the domain it names ahead of the proxy entry', async () => {
    const { app } = await start({ trustProxy: true });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, 'internal.login-tests.net', {
      'x-forwarded-host': `${host}, spoof.login-tests.net`,
    }).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(404);
  });
});

describe('with no base URL configured', () => {
  it('resolves no host at all', async () => {
    const { app, lookups } = await start({ publicBaseUrl: undefined });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, host).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(404);
    const path = await new Browser(app, host).get(
      `/tenants/${tenant.name}/.well-known/openid-configuration`,
    );
    expect(path.statusCode).toBe(200);
    expect(lookups).toEqual([]);
  });
});

describe('the throttles and input hygiene of a tenant route', () => {
  const body = (extra: Record<string, string> = {}) => ({
    auth_session_id: newId(),
    username: 'someone',
    password: 'wrong password',
    ...extra,
  });

  it.each([
    ['sign-in', 'authenticate'],
    ['registration', 'registration'],
    ['reset', 'reset-password'],
  ])('refuses a fourth %s POST on a domain with the page the path gives', async (_n, action) => {
    const { app } = await start({ throttle: { limit: 3, windowSeconds: 60 } });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const onDomain = new Browser(app, host);
    for (let i = 0; i < 3; i += 1) {
      expect((await onDomain.post(`/login-actions/${action}`, body())).statusCode).not.toBe(429);
    }
    const refused = await onDomain.post(`/login-actions/${action}`, body());
    expect(refused.statusCode).toBe(429);

    const twin = await newTenant();
    const other = await start({ throttle: { limit: 3, windowSeconds: 60 } });
    const onPath = new Browser(other.app, BASE_HOST);
    for (let i = 0; i < 3; i += 1) {
      await onPath.post(`/tenants/${twin.name}/login-actions/${action}`, body());
    }
    const same = await onPath.post(`/tenants/${twin.name}/login-actions/${action}`, body());
    expect(comparable(refused)).toEqual(comparable(same));
  });

  it('counts a username from one address against the composite budget', async () => {
    const { app } = await start({ loginThrottle: { limit: 2, windowSeconds: 60 } });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const browser = new Browser(app, host);
    const fields = body({ username: tenant.username });
    for (let i = 0; i < 2; i += 1) {
      expect((await browser.post('/login-actions/authenticate', fields)).statusCode).not.toBe(429);
    }
    const refused = await browser.post('/login-actions/authenticate', fields);
    expect(refused.statusCode).toBe(429);
    const elsewhere = await browser.post(
      '/login-actions/authenticate',
      body({ username: 'fresh' }),
    );
    expect(elsewhere.statusCode).not.toBe(429);
  });

  it('neutralises a NUL and a lone surrogate exactly as the path address does', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const hostile = body({ username: 'a\u0000b\ud800c', password: 'x\u0000y' });
    const onDomain = await new Browser(app, host).post('/login-actions/authenticate', hostile);
    const twin = await newTenant();
    const onPath = await new Browser(app, BASE_HOST).post(
      `/tenants/${twin.name}/login-actions/authenticate`,
      hostile,
    );
    expect(onDomain.statusCode).toBeLessThan(500);
    expect(comparable(onDomain)).toEqual(comparable(onPath));
    const query = await new Browser(app, host).get('/protocol/openid-connect/auth?client_id=a%00b');
    expect(query.statusCode).toBeLessThan(500);
  });
});

describe('CORS', () => {
  it.each(['token', 'userinfo'])(
    'answers a preflight for %s on a domain as on the path',
    async (endpoint) => {
      const { app } = await start();
      const tenant = await newTenant();
      const host = await addDomain(tenant, 'canonical');
      const headers = {
        origin: SPA_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization',
      };
      const onDomain = await new Browser(app, host).send(
        'OPTIONS',
        `/protocol/openid-connect/${endpoint}`,
        { headers },
      );
      const twin = await newTenant();
      const onPath = await new Browser(app, BASE_HOST).send(
        'OPTIONS',
        `/tenants/${twin.name}/protocol/openid-connect/${endpoint}`,
        { headers },
      );
      expect(onPath.headers['access-control-allow-origin']).toBe(SPA_ORIGIN);
      expect(onDomain.headers['access-control-allow-origin']).toBe(SPA_ORIGIN);
      expect(comparable(onDomain)).toEqual(comparable(onPath));
    },
  );

  it('answers no preflight for a host that is not live', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'pending');
    const res = await new Browser(app, host).send('OPTIONS', '/protocol/openid-connect/token', {
      headers: { origin: SPA_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('the account pages on a domain', () => {
  it.each([
    ['registration', 'registration', undefined],
    ['reset-password', 'reset-password', undefined],
    ['action-token', 'action-token', 'key=not-a-key'],
  ])('write the domain, not a path, into every link of %s', async (_name, page, query) => {
    const { app } = await start();
    const tenant = await newTenant();
    await owner.db.execute(
      sql`update tenants set registration_allowed = true, reset_password_allowed = true where id = ${tenant.id}`,
    );
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, host).get(
      `/login-actions/${page}${query === undefined ? '' : `?${query}`}`,
    );
    expect(res.statusCode).toBeLessThan(500);
    const found = targets(res.body);
    expect(found.filter((t) => t.includes('/tenants/'))).toEqual([]);
    if (page !== 'action-token') {
      expect(found).toContain(`/login-actions/${page}`);
    }
  });
});

describe('a required action on a domain', () => {
  async function walk(browser: Browser, tenant: Tenant) {
    let res = await browser.get(authorizeUrl('', 'portal'));
    const actions: string[] = [];
    let secret = '';
    let password = PASSWORD;
    for (let turn = 0; turn < 12 && res.statusCode === 200; turn += 1) {
      const { action, fields } = firstForm(res.body);
      actions.push(action);
      if (res.body.includes('Set up your authenticator')) {
        secret = fields.secret ?? '';
        fields.code = totpCode(secret, totpCounter(new Date()));
      } else if (res.body.includes('Change your password')) {
        password = NEW_PASSWORD;
        fields.password = password;
      } else if (res.body.includes('name="username"')) {
        fields.username = tenant.username;
        fields.password = password;
      }
      res = await browser.post(action, fields);
    }
    return { final: res, actions };
  }

  it('completes TOTP enrolment and a password change at the paths of the domain itself', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    await owe(tenant, ['update-password', 'configure-totp']);
    const host = await addDomain(tenant, 'canonical');
    const { final, actions } = await walk(new Browser(app, host), tenant);
    expect(final.statusCode).toBe(302);
    expect(new URL(String(final.headers.location)).searchParams.get('code')).not.toBeNull();
    expect(actions.length).toBeGreaterThanOrEqual(4);
    for (const action of actions) expect(action.startsWith('/login-actions/'), action).toBe(true);
  });
});

describe('a full authorization code flow on a domain', () => {
  it('states the domain as the issuer everywhere and keeps its cookies at the root', async () => {
    const { app } = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const issuer = `https://${host}`;
    const browser = new Browser(app, host);

    const discovery = (await browser.get('/.well-known/openid-configuration')).json<{
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      end_session_endpoint: string;
    }>();
    expect(discovery.issuer).toBe(issuer);
    const pathOf = (url: string) => new URL(url).pathname;

    const login = await browser.get(
      `${pathOf(discovery.authorization_endpoint)}?${authorizeQuery('consenter')}`,
    );
    expect(login.statusCode).toBe(200);
    const handleCookie = browser.seen.flat().find((line) => line.includes('odudu-sign-in='));
    expect(handleCookie).toContain('Path=/;');
    expect(handleCookie).not.toContain('/tenants/');

    const form = firstForm(login.body);
    const signedIn = await browser.post(form.action, {
      ...form.fields,
      username: tenant.username,
      password: PASSWORD,
    });
    let landed = signedIn;
    if (landed.statusCode === 200) {
      expect(landed.body).toContain('is asking for access');
      const consent = firstForm(landed.body);
      expect(consent.action.startsWith('/login-actions/')).toBe(true);
      landed = await browser.post(consent.action, { ...consent.fields, decision: 'allow' });
    }
    const sessionCookie = browser.seen.flat().find((line) => line.includes('-session='));
    expect(sessionCookie).toMatch(new RegExp(`^__Host-${tenant.name}-session=`, 'u'));
    expect(sessionCookie).toContain('Path=/;');

    expect(landed.statusCode).toBe(302);
    const redirect = new URL(String(landed.headers.location));
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get('iss')).toBe(issuer);

    const token = await browser.post(pathOf(discovery.token_endpoint), {
      grant_type: 'authorization_code',
      code: redirect.searchParams.get('code') ?? '',
      redirect_uri: REDIRECT_URI,
      client_id: 'consenter',
      code_verifier: VERIFIER,
    });
    expect(token.statusCode).toBe(200);
    const issued = token.json<{ id_token: string; access_token: string }>();
    const claims = JSON.parse(
      Buffer.from(issued.id_token.split('.')[1] ?? '', 'base64url').toString(),
    ) as { iss: string };
    expect(claims.iss).toBe(issuer);

    const userinfo = await browser.get(pathOf(discovery.userinfo_endpoint), {
      authorization: `Bearer ${issued.access_token}`,
    });
    expect(userinfo.statusCode).toBe(200);

    const confirm = await browser.get(
      `${pathOf(discovery.end_session_endpoint)}?${new URLSearchParams({
        id_token_hint: issued.id_token,
        post_logout_redirect_uri: LOGOUT_URI,
        state: 'bye',
        client_id: 'consenter',
      }).toString()}`,
    );
    expect(confirm.statusCode).toBe(200);
    const out = firstForm(confirm.body);
    expect(out.action.startsWith('/')).toBe(true);
    expect(out.action.startsWith('/tenants/')).toBe(false);
    const ended = await browser.post(out.action, out.fields);
    expect(ended.statusCode).toBe(302);
    expect(String(ended.headers.location).startsWith(LOGOUT_URI)).toBe(true);
    const cleared = browser.seen.flat().filter((line) => line.includes('Max-Age=0'));
    expect(cleared.some((line) => line.startsWith(`__Host-${tenant.name}-session=;`))).toBe(true);
    for (const line of browser.seen.flat()) expect(line).not.toContain('/tenants/');
  });
});

describe('the error pages of a domain', () => {
  let docs: string;
  const CONSOLE = 'https://console.example.test';
  const PAGE = { accept: 'text/html,application/xhtml+xml' };
  const operator = { consoleBaseUrl: CONSOLE, consoleKeys: CONSOLE_KEYS } as const;

  beforeAll(async () => {
    docs = await mkdtemp(join(tmpdir(), 'domain-docs-'));
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, 'index.html'), '<!doctype html><title>Docs</title>');
    await writeFile(
      join(docs, 'csp.json'),
      JSON.stringify({ scriptHashes: [`sha256-${'A'.repeat(43)}=`], styleAttributeHashes: [] }),
    );
  });

  afterAll(async () => {
    await rm(docs, { recursive: true, force: true });
  });

  it.each(['/', '/login-actions/zzz', '/nothing-here'])(
    'draws the 404 for %s without the operator console or docs',
    async (path) => {
      const { app } = await start({ extra: { ...operator, docsDir: docs } });
      const tenant = await newTenant();
      const host = await addDomain(tenant, 'canonical');
      const res = await new Browser(app, host).get(path, PAGE);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(CONSOLE);
      expect(res.body).not.toContain('/docs/');
      expect(res.body).not.toContain(BASE_HOST);
    },
  );

  it('keeps the links on the path address and the base host, unchanged', async () => {
    const { app } = await start({ extra: { ...operator, docsDir: docs } });
    const tenant = await newTenant();
    const onBase = await new Browser(app, BASE_HOST).get('/nothing-here', PAGE);
    expect(onBase.body).toContain(CONSOLE);
    expect(onBase.body).toContain('/docs/');
    const onPath = await new Browser(app, BASE_HOST).get(`/tenants/${tenant.name}/`, PAGE);
    expect(onPath.statusCode).toBe(404);
    expect(onPath.body).toContain(CONSOLE);
    expect(onPath.body).toContain('/docs/');
  });

  it('draws a failed lookup without any operator URL', async () => {
    const { app } = await start({
      extra: {
        ...operator,
        docsDir: docs,
        hostState: () => Promise.reject(new Error('down')),
      },
    });
    const res = await new Browser(app, 'anything.login-tests.net').get('/', PAGE);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(CONSOLE);
    expect(res.body).not.toContain('/docs/');
  });
});

describe('a trailing empty X-Forwarded-Host entry', () => {
  it('names no host, so no tenant is selected', async () => {
    const { app } = await start({ trustProxy: true });
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    const res = await new Browser(app, 'internal.login-tests.net', {
      'x-forwarded-host': `${host},`,
    }).get('/.well-known/openid-configuration');
    expect(res.statusCode).toBe(404);
  });
});
