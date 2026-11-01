import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function call(
  tenant: string,
  token: string,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  payload?: object,
  ifMatch?: string,
) {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenant}${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

// A tenant offering `locales`, with one client, and the id the client has.
async function tenantWith(locales: string[]) {
  const t = await fixture.createTenant(`lang-${newId()}`);
  const admin = await fixture.adminToken(t.name, ['manage-tenant']);
  const settings = await call(t.name, admin, 'PATCH', '/settings', { supported_locales: locales });
  expect(settings.statusCode, settings.body).toBe(200);
  const clients = await fixture.adminToken(t.name, ['manage-clients']);
  const made = await call(t.name, clients, 'POST', '/clients', {
    client_id: `app-${newId()}`,
    redirect_uris: ['https://app.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  expect(made.statusCode, made.body).toBe(201);
  return { name: t.name, clients, id: made.json<{ id: string }>().id };
}

describe('the languages a client may be translated into', () => {
  it('are the tenant’s, on the client’s own read, for a caller who may only manage clients', async () => {
    const t = await tenantWith(['en', 'fr']);
    const res = await call(t.name, t.clients, 'GET', `/clients/${t.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ supported_locales: string[] }>().supported_locales).toEqual(['en', 'fr']);
    expect((await call(t.name, t.clients, 'GET', '/settings')).statusCode).toBe(403);
  });

  it('come back on an amendment too, so a saved record keeps them', async () => {
    const t = await tenantWith(['en', 'fr']);
    const read = await call(t.name, t.clients, 'GET', `/clients/${t.id}`);
    const res = await call(
      t.name,
      t.clients,
      'PATCH',
      `/clients/${t.id}`,
      { name_i18n: { fr: 'Facturation' } },
      String(read.headers.etag),
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      name_i18n: { fr: 'Facturation' },
      supported_locales: ['en', 'fr'],
    });
  });

  it('are left off a list, which stays as it was', async () => {
    const t = await tenantWith(['en', 'fr']);
    const list = await call(t.name, t.clients, 'GET', '/clients');
    const items = list.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).not.toHaveProperty('supported_locales');
  });

  it('never cross tenants: another tenant’s client is a 404, and each tenant reads its own', async () => {
    const mine = await tenantWith(['en', 'fr']);
    const theirs = await tenantWith(['en', 'de']);
    const foreign = await call(mine.name, mine.clients, 'GET', `/clients/${theirs.id}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain('"de"');
    const own = await call(theirs.name, theirs.clients, 'GET', `/clients/${theirs.id}`);
    expect(own.json<{ supported_locales: string[] }>().supported_locales).toEqual(['en', 'de']);
  });
});
