import { createDatabase, MIGRATIONS_DIR, runMigrations, tenants, withTenant } from '@odudu/db';
import { type DatabaseHandle } from '@odudu/db';
import { hostState, tenantDomainRepository } from '@odudu/domain-tenant';
import {
  addressIssuer,
  domainAddress,
  loadConfig,
  mcpAudienceOfIssuer,
  newId,
} from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// A tenant that has its own domain, reached by it: the audience
// the `mcp` registration policy stores is the one the authorization endpoint
// holds a client to, so ending the policy strips it.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const BASE_HOST = 'id.example.com';

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

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function mcpTenantWithDomain(): Promise<{ name: string; id: string }> {
  const name = `dom-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: `u${newId().slice(-8)}`,
    password: 'correct horse battery staple',
  });
  await withTenant(appDb.db, seeded.tenantId, async (tx) => {
    const domains = tenantDomainRepository(tx);
    const row = await domains.insert({
      tenantId: seeded.tenantId,
      host: `d${name.slice(-8)}.domain-tests.net`,
      challenge: 'c',
    });
    await domains.markVerified(seeded.tenantId, row.id, new Date());
    await domains.setCanonical(seeded.tenantId, row.id);
  });
  await owner.db
    .update(tenants)
    .set({ clientRegistrationPolicy: 'mcp' })
    .where(eq(tenants.id, seeded.tenantId));
  return { name, id: seeded.tenantId };
}

describe('the mcp policy on a tenant that has a domain', () => {
  it('stores the audience the authorization endpoint holds the client to, and ends with the policy', async () => {
    const t = await mcpTenantWithDomain();
    const host = `d${t.name.slice(-8)}.domain-tests.net`;

    // The path address no longer serves registration for such a tenant, so
    // the only audience that can be stored is the domain's.
    const atPath = await app.inject({
      method: 'POST',
      url: `/tenants/${t.name}/clients-registrations/openid-connect`,
      headers: { host: BASE_HOST },
      payload: { redirect_uris: ['https://rp.example/cb'], token_endpoint_auth_method: 'none' },
    });
    expect(atPath.statusCode).toBe(404);

    const registered = await app.inject({
      method: 'POST',
      url: '/clients-registrations/openid-connect',
      headers: { host },
      payload: { redirect_uris: ['https://rp.example/cb'], token_endpoint_auth_method: 'none' },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const body = registered.json<{ client_id: string; audience: string[] }>();
    const expected = mcpAudienceOfIssuer(addressIssuer(domainAddress(host, true)));
    expect(expected).toBe(`https://${host}/mcp`);
    expect(body.audience).toEqual([expected]);

    const authorize = () =>
      app.inject({
        url: `/protocol/openid-connect/auth?${new URLSearchParams({
          response_type: 'code',
          client_id: body.client_id,
          redirect_uri: 'https://rp.example/cb',
          scope: 'openid',
          state: 's',
          resource: expected,
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
        }).toString()}`,
        headers: { host },
      });

    expect((await authorize()).statusCode).toBe(200);

    await owner.db
      .update(tenants)
      .set({ clientRegistrationPolicy: 'disabled' })
      .where(eq(tenants.id, t.id));
    const stripped = await authorize();
    expect(stripped.statusCode).toBe(302);
    expect(new URL(String(stripped.headers.location)).searchParams.get('error')).toBe(
      'invalid_target',
    );
  });
});

describe('the mcp policy across a change of address', () => {
  it('holds a client registered at the path address to the domain MCP URL after the switch, and to none once the policy ends', async () => {
    const name = `sw-${newId()}`;
    const seeded = await seed({
      tenant: name,
      clientId: 'portal',
      redirectUris: ['https://app.example/callback'],
      username: `u${newId().slice(-8)}`,
      password: 'correct horse battery staple',
    });
    await owner.db
      .update(tenants)
      .set({ clientRegistrationPolicy: 'mcp' })
      .where(eq(tenants.id, seeded.tenantId));

    const registered = await app.inject({
      method: 'POST',
      url: `/tenants/${name}/clients-registrations/openid-connect`,
      headers: { host: BASE_HOST },
      payload: { redirect_uris: ['https://rp.example/cb'], token_endpoint_auth_method: 'none' },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    const { client_id: clientId } = registered.json<{ client_id: string }>();

    const host = `s${name.slice(-8)}.domain-tests.net`;
    await withTenant(appDb.db, seeded.tenantId, async (tx) => {
      const domains = tenantDomainRepository(tx);
      const row = await domains.insert({ tenantId: seeded.tenantId, host, challenge: 'c' });
      await domains.markVerified(seeded.tenantId, row.id, new Date());
      await domains.setCanonical(seeded.tenantId, row.id);
    });

    const oldUrl = `${BASE}/tenants/${name}/mcp`;
    const newUrl = `https://${host}/mcp`;
    const authorize = (resource: string) =>
      app.inject({
        url: `/protocol/openid-connect/auth?${new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: 'https://rp.example/cb',
          scope: 'openid',
          state: 's',
          resource,
          code_challenge: CHALLENGE,
          code_challenge_method: 'S256',
        }).toString()}`,
        headers: { host },
      });
    const errorOf = (res: Awaited<ReturnType<typeof authorize>>) =>
      res.statusCode === 302
        ? new URL(String(res.headers.location)).searchParams.get('error')
        : null;

    expect((await authorize(newUrl)).statusCode).toBe(200);

    await owner.db
      .update(tenants)
      .set({ clientRegistrationPolicy: 'disabled' })
      .where(eq(tenants.id, seeded.tenantId));
    expect(errorOf(await authorize(newUrl))).toBe('invalid_target');
    expect(errorOf(await authorize(oldUrl))).toBe('invalid_target');
  });
});
