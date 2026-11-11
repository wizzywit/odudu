import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { MCP_CLIENT_ID } from '@odudu/domain-tenant';
import { ME_ROUTES } from '@odudu/me';
import { loadConfig, mcpAudienceOfIssuer, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { mcpWorld } from '#/testing/mcp-world';

// A token for the "me" API opens no MCP route and an MCP token opens no "me"
// route. Both tables are read from the routes the app registered, so a route
// added to either is covered without this file being touched.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;
const registered: { method: string; url: string }[] = [];

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';

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
    onRoute: (route) => {
      for (const method of [route.method].flat()) registered.push({ method, url: route.url });
    },
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

const tableOf = (door: string) =>
  registered.filter(
    (route) =>
      route.url === `/tenants/:tenant/${door}` || route.url.startsWith(`/tenants/:tenant/${door}/`),
  );

async function tokenFor(
  audience: (issuer: string) => string,
  scope: string,
  tenant: { name: string; id: string; subjectId: string },
) {
  const issuer = `${BASE}/tenants/${tenant.name}`;
  const key = await withTenant(appDb.db, tenant.id, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: issuer,
      sub: tenant.subjectId,
      aud: [audience(issuer)],
      client_id: 'portal',
      scope,
      iat,
      exp: iat + 600,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function tenant() {
  const name = `door-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  return { name, id: seeded.tenantId, subjectId: seeded.userSubjectId };
}

function send(route: { method: string; url: string }, name: string, token: string) {
  const method = route.method as 'GET' | 'HEAD' | 'POST' | 'DELETE';
  return app.inject({
    method,
    url: route.url.replace(':tenant', name),
    headers: {
      host: HOST,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    ...(method === 'POST'
      ? { payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }
      : {}),
  });
}

describe('the route tables', () => {
  it('are not empty, and the "me" one is the one the package exports', () => {
    expect(tableOf('mcp').length).toBeGreaterThan(0);
    expect(tableOf('me').length).toBeGreaterThan(0);
    expect(
      tableOf('me')
        .filter((r) => r.method !== 'HEAD')
        .map((r) => `${r.method} ${r.url}`)
        .sort(),
    ).toEqual(ME_ROUTES.map((r) => `${r.method} ${r.url}`).sort());
  });
});

describe('each door refuses the other’s token', () => {
  it('refuses a "me" token at every MCP route', async () => {
    const t = await tenant();
    const token = await tokenFor(meAudienceOfIssuer, 'openid me:read me:write', t);
    for (const route of tableOf('mcp')) {
      const res = await send(route, t.name, token);
      const expected = route.method === 'POST' ? 401 : 405;
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(expected);
    }
  });

  it('refuses an MCP token at every "me" route', async () => {
    const t = await tenant();
    const token = await tokenFor(mcpAudienceOfIssuer, 'openid mcp:read mcp:write', t);
    for (const route of tableOf('me')) {
      const res = await send(route, t.name, token);
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('opens each door to its own token, so a refusal above is the audience’s', async () => {
    const t = await tenant();
    const me = await tokenFor(meAudienceOfIssuer, 'openid me:read', t);
    const own = tableOf('me')[0];
    const mcpPost = tableOf('mcp').find((r) => r.method === 'POST');
    if (own === undefined || mcpPost === undefined) throw new Error('a table is empty');
    expect((await send(own, t.name, me)).statusCode).toBe(200);

    const w = await mcpWorld(appDb, BASE, ['view-users'], 'openid mcp:read');
    const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
    const iat = Math.floor(Date.now() / 1000);
    const mcp = await signJwt(
      {
        iss: w.issuer,
        sub: w.subjectId,
        aud: [mcpAudienceOfIssuer(w.issuer)],
        client_id: MCP_CLIENT_ID,
        grant_id: w.grantId,
        sid: w.sessionId,
        scope: 'openid mcp:read',
        iat,
        exp: iat + 600,
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
    expect((await send(mcpPost, w.name, mcp)).statusCode).not.toBe(401);
  });
});
