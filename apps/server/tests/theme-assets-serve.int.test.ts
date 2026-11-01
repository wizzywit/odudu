import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, makePng, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { mintAdminToken } from '#/testing/plan-admin-drives';

// An image goes in through the admin API and comes out of the public brand
// route, and only once a published theme names it.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger: pino({ level: 'silent' }),
    tls: false,
    publicBaseUrl: 'https://id.example.test',
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

async function tenant(): Promise<{ name: string; token: string }> {
  const name = `assets-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'user',
    password: 'correct horse battery staple',
  });
  const token = await mintAdminToken({ http: app, app: appDb }, { id: seeded.tenantId, name }, [
    'manage-tenant',
  ]);
  return { name, token };
}

describe('an uploaded image', () => {
  it('is not served until a published theme names it, and not after it is dropped', async () => {
    const t = await tenant();
    const auth = { authorization: `Bearer ${t.token}` };
    const up = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/theme/assets?kind=logo`,
      headers: { ...auth, 'content-type': 'image/png' },
      payload: makePng({ width: 10, height: 6 }),
    });
    expect(up.statusCode, up.body).toBe(201);
    const image = up.json<{ id: string; sha256: string }>();
    const url = `/tenants/${t.name}/brand/${image.sha256}.png`;

    expect((await app.inject({ url })).statusCode, 'uploaded only').toBe(404);

    const draft = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/theme`,
      headers: { ...auth, 'content-type': 'application/json' },
      payload: { assets: { logo: { assetId: image.id, alt: 'Logo' } } },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect((await app.inject({ url })).statusCode, 'a draft names it').toBe(404);

    const published = await app.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/theme/publish`,
      headers: auth,
    });
    expect(published.statusCode, published.body).toBe(200);
    const served = await app.inject({ url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');

    const refused = await app.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/theme/assets/${image.id}`,
      headers: auth,
    });
    expect(refused.statusCode).toBe(409);

    await app.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/theme`,
      headers: auth,
    });
    expect((await app.inject({ url })).statusCode, 'reset archives the version').toBe(404);
  });
});
