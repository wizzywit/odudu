import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { hostState, tenantDomainRepository } from '@odudu/domain-tenant';
import { loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// RFC 9728 metadata: one document per tenant at the URL its MCP URL derives,
// naming that URL as the resource and the tenant issuer as its authorization
// server.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const BASE_HOST = 'id.example.com';
const SUFFIX = '/.well-known/oauth-protected-resource';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const config = loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' });
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: createLogger(config),
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
    hostState: (host) => hostState(owner.db, host, new Date()),
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

async function newTenant(): Promise<{ name: string; id: string }> {
  const name = `prm-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: `u${newId().slice(-8)}`,
    password: 'correct horse battery staple',
  });
  return { name, id: seeded.tenantId };
}

let hostCounter = 0;

async function addCanonicalDomain(tenant: { id: string }): Promise<string> {
  const host = `r${String((hostCounter += 1))}.resource-tests.net`;
  await withTenant(appDb.db, tenant.id, async (tx) => {
    const domains = tenantDomainRepository(tx);
    const row = await domains.insert({ tenantId: tenant.id, host, challenge: 'c' });
    await domains.markVerified(tenant.id, row.id, new Date());
    await domains.setCanonical(tenant.id, row.id);
  });
  return host;
}

const atBase = (path: string, method: 'GET' | 'POST' = 'GET') =>
  app.inject({ method, url: path, headers: { host: BASE_HOST } });

interface Resource {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

describe('protected resource metadata at the path address', () => {
  it('[RFC9728-3-01] serves the document at the path-inserted URL', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`);
    expect(res.statusCode).toBe(200);
    expect(res.json<Resource>().resource).toBe(`${BASE}/tenants/${t.name}/mcp`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('[RFC9728-3-02] uses the registered oauth-protected-resource suffix', async () => {
    const t = await newTenant();
    expect(SUFFIX).toBe('/.well-known/oauth-protected-resource');
    expect((await atBase(`${SUFFIX}/tenants/${t.name}/mcp`)).statusCode).toBe(200);
  });

  it('[RFC9728-3.1-01] is read with GET only', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`, 'POST');
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain('"resource"');
  });

  it('[RFC9728-3.2-01] answers 200 OK with a JSON object', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/u);
  });

  it('[RFC9728-3.2-02] states only members RFC 9728 section 2 defines', async () => {
    const t = await newTenant();
    const doc = (await atBase(`${SUFFIX}/tenants/${t.name}/mcp`)).json<Record<string, unknown>>();
    expect(Object.keys(doc).sort()).toEqual([
      'authorization_servers',
      'bearer_methods_supported',
      'resource',
      'scopes_supported',
    ]);
  });

  it('[RFC9728-3.2-03] omits a member with no value', async () => {
    const t = await newTenant();
    const doc = (await atBase(`${SUFFIX}/tenants/${t.name}/mcp`)).json<Record<string, unknown>>();
    for (const value of Object.values(doc)) expect(value).not.toEqual([]);
  });

  it('[RFC9728-2-02] names the tenant issuer its authorization server metadata states', async () => {
    const t = await newTenant();
    const doc = (await atBase(`${SUFFIX}/tenants/${t.name}/mcp`)).json<Resource>();
    const as = (await atBase(`/.well-known/oauth-authorization-server/tenants/${t.name}`)).json<{
      issuer: string;
    }>();
    expect(doc.authorization_servers).toEqual([as.issuer]);
    expect(doc.scopes_supported).toEqual(['mcp:read', 'mcp:write']);
    expect(doc.bearer_methods_supported).toEqual(['header']);
  });

  it('answers an unknown and a disabled tenant with the same empty 404', async () => {
    const t = await newTenant();
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, t.id));
    const disabled = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`);
    const unknown = await atBase(`${SUFFIX}/tenants/never-${newId().toLowerCase()}/mcp`);
    for (const res of [disabled, unknown]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('');
    }
    expect(disabled.headers['content-length']).toBe(unknown.headers['content-length']);
  });

  it('refuses a tenant segment no database parameter can hold', async () => {
    const res = await atBase(`${SUFFIX}/tenants/a%00b/mcp`);
    expect(res.statusCode).toBe(404);
  });

  it('does not answer at the path address under the tenant', async () => {
    const t = await newTenant();
    const res = await atBase(`/tenants/${t.name}${SUFFIX}/mcp`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('"resource"');
  });

  it('takes its resource from the configured address, never from Host', async () => {
    const t = await newTenant();
    const res = await app.inject({
      method: 'GET',
      url: `${SUFFIX}/tenants/${t.name}/mcp`,
      headers: { host: BASE_HOST, 'x-forwarded-host': 'evil.example' },
    });
    expect(res.json<Resource>().resource).toBe(`${BASE}/tenants/${t.name}/mcp`);
  });
});

describe('protected resource metadata at a tenant domain', () => {
  it('[RFC9728-3.3-02] answers at the domain with the domain as resource and issuer', async () => {
    const t = await newTenant();
    const host = await addCanonicalDomain(t);
    const res = await app.inject({ method: 'GET', url: `${SUFFIX}/mcp`, headers: { host } });
    expect(res.statusCode).toBe(200);
    const doc = res.json<Resource>();
    expect(doc.resource).toBe(`https://${host}/mcp`);
    expect(doc.authorization_servers).toEqual([`https://${host}`]);
  });

  it('no longer answers at the path-inserted URL once the domain is canonical', async () => {
    const t = await newTenant();
    await addCanonicalDomain(t);
    const res = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('');
  });

  it('keeps answering at the path-inserted URL for the window after a switch', async () => {
    const t = await newTenant();
    await addCanonicalDomain(t);
    await withTenant(appDb.db, t.id, (tx) =>
      tenantDomainRepository(tx).retireIssuer(
        t.id,
        `${BASE}/tenants/${t.name}`,
        new Date(Date.now() + 3_600_000),
      ),
    );
    const res = await atBase(`${SUFFIX}/tenants/${t.name}/mcp`);
    expect(res.statusCode).toBe(200);
    expect(res.json<Resource>().resource).toBe(`${BASE}/tenants/${t.name}/mcp`);
  });

  it('does not answer at the path-inserted URL on a tenant domain', async () => {
    const t = await newTenant();
    const host = await addCanonicalDomain(t);
    const res = await app.inject({
      method: 'GET',
      url: `${SUFFIX}/tenants/${t.name}/mcp`,
      headers: { host },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('"resource"');
  });
});
