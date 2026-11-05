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

// RFC 8414 metadata: one document per tenant, at the URL its canonical issuer
// derives, stating that issuer and no other.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const BASE_HOST = 'id.example.com';
const SUFFIX = '/.well-known/oauth-authorization-server';

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
  const name = `asm-${newId()}`;
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
  const host = `m${String((hostCounter += 1))}.metadata-tests.net`;
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

describe('authorization server metadata at the path address', () => {
  it('[RFC8414-3-01] serves the document at the path-inserted URL', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}`);
    expect(res.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${t.name}`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('[RFC8414-3-02] uses the registered oauth-authorization-server suffix', async () => {
    const t = await newTenant();
    const { issuer } = (await atBase(`${SUFFIX}/tenants/${t.name}`)).json<{ issuer: string }>();
    const { origin, pathname } = new URL(issuer);
    expect(`${origin}${SUFFIX}${pathname}`).toBe(`${BASE}${SUFFIX}/tenants/${t.name}`);
    const lookalike = await atBase(`/.well-known/oauth-authorization-servers/tenants/${t.name}`);
    expect(lookalike.statusCode).toBe(404);
  });

  it('[RFC8414-3.2-01] answers 200 OK', async () => {
    const t = await newTenant();
    expect((await atBase(`${SUFFIX}/tenants/${t.name}`)).statusCode).toBe(200);
  });

  it('[RFC8414-3.2-02] answers a JSON object as application/json', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}`);
    expect(res.headers['content-type']).toMatch(/^application\/json/u);
    expect(typeof res.json<unknown>()).toBe('object');
  });

  it('[RFC8414-3.1-01] is read with GET only', async () => {
    const t = await newTenant();
    const res = await atBase(`${SUFFIX}/tenants/${t.name}`, 'POST');
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('"issuer"');
  });

  it('[RFC8414-3.3-01] states the issuer the discovery document states, and the endpoints under it', async () => {
    const t = await newTenant();
    const meta = (await atBase(`${SUFFIX}/tenants/${t.name}`)).json<Record<string, unknown>>();
    const disc = (await atBase(`/tenants/${t.name}/.well-known/openid-configuration`)).json<
      Record<string, unknown>
    >();
    expect(meta.issuer).toBe(disc.issuer);
    for (const key of [
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'revocation_endpoint',
    ]) {
      expect(meta[key], key).toBe(disc[key]);
    }
  });

  it('lists what a Model Context Protocol client reads', async () => {
    const t = await newTenant();
    const meta = (await atBase(`${SUFFIX}/tenants/${t.name}`)).json<Record<string, unknown>>();
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.authorization_response_iss_parameter_supported).toBe(true);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(
      expect.arrayContaining(['none', 'private_key_jwt']),
    );
    expect(meta.scopes_supported).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write']));
    expect(meta).not.toHaveProperty('registration_endpoint');
    expect(meta).not.toHaveProperty('client_id_metadata_document_supported');
  });

  it('answers an unknown and a disabled tenant with the same empty 404', async () => {
    const t = await newTenant();
    await owner.db.update(tenants).set({ enabled: false }).where(eq(tenants.id, t.id));
    const disabled = await atBase(`${SUFFIX}/tenants/${t.name}`);
    const unknown = await atBase(`${SUFFIX}/tenants/never-${newId().toLowerCase()}`);
    for (const res of [disabled, unknown]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe('');
    }
    expect(disabled.headers['content-length']).toBe(unknown.headers['content-length']);
  });

  it('refuses a tenant segment no database parameter can hold', async () => {
    const res = await atBase(`${SUFFIX}/tenants/a%00b`);
    expect(res.statusCode).toBe(404);
  });

  it('does not answer at the path address under the tenant', async () => {
    const t = await newTenant();
    const res = await atBase(`/tenants/${t.name}${SUFFIX}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('"issuer"');
  });

  it('takes its issuer from the configured address, never from Host', async () => {
    const t = await newTenant();
    const res = await app.inject({
      method: 'GET',
      url: `${SUFFIX}/tenants/${t.name}`,
      headers: { host: BASE_HOST, 'x-forwarded-host': 'evil.example' },
    });
    expect(res.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${t.name}`);
  });
});

describe('authorization server metadata at a tenant domain', () => {
  it('answers at the root of the canonical domain with the domain as issuer', async () => {
    const t = await newTenant();
    const host = await addCanonicalDomain(t);
    const res = await app.inject({ method: 'GET', url: SUFFIX, headers: { host } });
    expect(res.statusCode).toBe(200);
    const meta = res.json<Record<string, string>>();
    expect(meta.issuer).toBe(`https://${host}`);
    expect(meta.token_endpoint).toBe(`https://${host}/protocol/openid-connect/token`);
  });

  it('no longer answers at the path-inserted URL once the domain is canonical', async () => {
    const t = await newTenant();
    await addCanonicalDomain(t);
    const res = await atBase(`${SUFFIX}/tenants/${t.name}`);
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
    const res = await atBase(`${SUFFIX}/tenants/${t.name}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${t.name}`);
  });

  it('does not answer at the path-inserted URL on a tenant domain', async () => {
    const t = await newTenant();
    const host = await addCanonicalDomain(t);
    const res = await app.inject({
      method: 'GET',
      url: `${SUFFIX}/tenants/${t.name}`,
      headers: { host },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('"issuer"');
  });
});
