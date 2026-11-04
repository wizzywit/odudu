import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type Database, type DatabaseHandle } from '@odudu/db';
import { tenantDomainRepository } from '@odudu/domain-tenant';
import { loadConfig } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type ThrottleSettings } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { CONSOLE_KEYS } from '#/testing/console-key';

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
const apps: FastifyInstance[] = [];
const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const counts = { transactions: 0 };

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

// Counts transaction starts: a tenant context is only ever taken in one.
function counting(handle: DatabaseHandle): DatabaseHandle {
  const db: Database = new Proxy(handle.db, {
    get(target, property, receiver): unknown {
      if (property === 'transaction') counts.transactions += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  return { db, sql: handle.sql, close: () => handle.close() };
}

interface Options {
  throttle?: ThrottleSettings;
  domainCheckThrottle?: ThrottleSettings;
}

async function start(options: Options = {}): Promise<FastifyInstance> {
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  const app = buildApp({
    database: counting(appDb),
    ownerDatabase: counting(owner),
    kek: KEK,
    logger: createLogger(config),
    tls: true,
    publicBaseUrl: BASE,
    throttle: options.throttle ?? { limit: 100_000, windowSeconds: 60 },
    ...(options.domainCheckThrottle === undefined
      ? {}
      : { domainCheckThrottle: options.domainCheckThrottle }),
    consoleBaseUrl: 'https://console.example.test',
    consoleKeys: CONSOLE_KEYS,
  });
  await app.ready();
  apps.push(app);
  return app;
}

interface Tenant {
  name: string;
  id: string;
}

async function newTenant(): Promise<Tenant> {
  const name = `chk-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'u1',
    password: 'correct horse battery staple',
  });
  return { name, id: seeded.tenantId };
}

type Kind = 'canonical' | 'idle' | 'pending' | 'failed';
let counter = 0;
const freshHost = (): string => `c${String((counter += 1))}.check-tests.net`;

async function addDomain(tenant: Tenant, kind: Kind, host = freshHost()): Promise<string> {
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

const ask = (app: FastifyInstance, domain: string, host = 'odudu:3000', ip?: string) =>
  app.inject({
    method: 'GET',
    url: `/internal/domain-check?domain=${encodeURIComponent(domain)}`,
    headers: { host },
    ...(ip === undefined ? {} : { remoteAddress: ip }),
  });

function shape(res: LightMyRequestResponse): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...res.headers };
  delete rest.date;
  delete rest['x-request-id'];
  return rest;
}

describe('GET /internal/domain-check against the database', () => {
  it('answers 200 for a live host and 404 for every host that is not', async () => {
    const app = await start();
    const tenant = await newTenant();
    const live = await addDomain(tenant, 'canonical');
    const pending = await addDomain(tenant, 'pending');
    const failed = await addDomain(tenant, 'failed');
    const idle = await addDomain(tenant, 'idle');
    expect((await ask(app, live)).statusCode).toBe(200);
    for (const host of [pending, failed, idle, 'nobody.check-tests.net']) {
      const res = await ask(app, host);
      expect(res.statusCode, host).toBe(404);
      expect(res.body, host).toBe('');
    }
    expect((await ask(app, '')).statusCode).toBe(404);
    expect((await ask(app, '127.0.0.1')).statusCode).toBe(404);
    expect((await ask(app, `${live}:8443`)).statusCode).toBe(404);
    expect((await ask(app, live.toUpperCase())).statusCode).toBe(200);
    const twice = await app.inject({
      method: 'GET',
      url: `/internal/domain-check?domain=${live}&domain=${live}`,
    });
    expect(twice.statusCode).toBe(404);
  });

  it('answers a host verified for another tenant only for the one that serves it', async () => {
    const app = await start();
    const first = await newTenant();
    const second = await newTenant();
    const host = freshHost();
    await addDomain(first, 'pending', host);
    expect((await ask(app, host)).statusCode).toBe(404);
    await addDomain(second, 'canonical', host);
    expect((await ask(app, host)).statusCode).toBe(200);
  });

  it('answers 200 inside a retirement window and 404 past it', async () => {
    const app = await start();
    const tenant = await newTenant();
    const inside = await addDomain(tenant, 'idle');
    const past = await addDomain(tenant, 'idle');
    await withTenant(appDb.db, tenant.id, async (tx) => {
      const domains = tenantDomainRepository(tx);
      await domains.retireIssuer(tenant.id, `https://${inside}`, new Date(Date.now() + 3_600_000));
      await domains.retireIssuer(tenant.id, `https://${past}`, new Date(Date.now() + 1_500));
    });
    expect((await ask(app, inside)).statusCode).toBe(200);
    expect((await ask(app, past)).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    expect((await ask(app, past)).statusCode).toBe(404);
    expect((await ask(app, inside)).statusCode).toBe(200);
  });

  it('answers 404 for the host of a disabled tenant', async () => {
    const app = await start();
    const tenant = await newTenant();
    const host = await addDomain(tenant, 'canonical');
    expect((await ask(app, host)).statusCode).toBe(200);
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, tenant.id));
    expect((await ask(app, host)).statusCode).toBe(404);
  });

  it('gives 200 and 404 the same headers and no body', async () => {
    const app = await start();
    const tenant = await newTenant();
    const live = await addDomain(tenant, 'canonical');
    const yes = await ask(app, live);
    const no = await ask(app, 'nobody.check-tests.net');
    expect(shape(yes)).toEqual(shape(no));
    expect(yes.body).toBe('');
    expect(no.body).toBe('');
  });

  it('answers the same whatever the Host, and is no tenant route on a domain host', async () => {
    const app = await start();
    const tenant = await newTenant();
    const live = await addDomain(tenant, 'canonical');
    for (const host of ['odudu:3000', live, 'unknown.check-tests.net', 'id.example.com']) {
      expect((await ask(app, live, host)).statusCode, host).toBe(200);
      expect((await ask(app, 'nobody.check-tests.net', host)).statusCode, host).toBe(404);
    }
    const asTenant = await app.inject({
      method: 'GET',
      url: `/tenants/${tenant.name}/internal/domain-check?domain=${live}`,
    });
    expect(asTenant.statusCode).toBe(404);
  });

  it('never takes a tenant context', async () => {
    const app = await start();
    const tenant = await newTenant();
    const live = await addDomain(tenant, 'canonical');
    counts.transactions = 0;
    await ask(app, live);
    await ask(app, 'nobody.check-tests.net');
    await ask(app, '');
    expect(counts.transactions).toBe(0);
  });

  it('answers 429 with Retry-After past its budget and leaves the sign-in budget alone', async () => {
    const app = await start({
      throttle: { limit: 2, windowSeconds: 60 },
      domainCheckThrottle: { limit: 3, windowSeconds: 60 },
    });
    const tenant = await newTenant();
    for (let i = 0; i < 3; i += 1) {
      expect((await ask(app, 'nobody.check-tests.net', 'odudu:3000', '10.1.1.1')).statusCode).toBe(
        404,
      );
    }
    const over = await ask(app, 'nobody.check-tests.net', 'odudu:3000', '10.1.1.1');
    expect(over.statusCode).toBe(429);
    expect(over.body).toBe('');
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    const signIn = () =>
      app.inject({
        method: 'POST',
        url: `/tenants/${tenant.name}/login-actions/authenticate`,
        remoteAddress: '10.1.1.1',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'username=u1&password=x',
      });
    expect((await signIn()).statusCode).not.toBe(429);
    expect((await signIn()).statusCode).not.toBe(429);
    expect((await signIn()).statusCode).toBe(429);

    expect((await ask(app, 'nobody.check-tests.net', 'odudu:3000', '10.2.2.2')).statusCode).toBe(
      404,
    );
  });
});
