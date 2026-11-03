import { expect, it } from 'vitest';
import {
  amendTenant,
  createTenant,
  deleteTenant,
  findTenant,
  importTenant,
  readExport,
  readSystemIssuer,
  readTenant,
  readTenantCount,
  readTenantPage,
} from '#/features/tenants/adapter/tenants';
import tenantList from '#/features/tenants/adapter/fixtures/tenant-list.json';
import tenantImport from '#/features/tenants/adapter/fixtures/tenant-import.json';
import tenantRecord from '#/features/tenants/adapter/fixtures/tenant.json';
import type { GatewayResult } from '#/shared/transport/gateway';
import { fakeTransport, json } from '#/testing/fakeTransport';

const SYSTEM = {
  name: 'system',
  displayName: 'System',
  enabled: true,
  createdAt: '2026-09-25T05:12:51.138Z',
};
const DEMO = {
  name: 'demo',
  displayName: 'Demo',
  enabled: true,
  createdAt: '2026-09-25T05:14:08.294Z',
};
const SHOWCASE = {
  name: 'showcase',
  displayName: 'Showcase',
  enabled: true,
  createdAt: '2026-09-28T23:16:00.990Z',
};

function dataOf<T>(result: GatewayResult<T>): T | undefined {
  return result.ok ? result.data : undefined;
}

it('lists and counts tenants with the query it is given', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants': json({ ...tenantList, next: 'c2' }),
    'GET /console/api/admin/tenants/count': json({ count: 1, capped: false }),
  });
  const query = new URLSearchParams({ name: 'ac', enabled: 'true' });
  expect(dataOf(await readTenantPage(fake.transport.gateway, query))).toEqual({
    items: [SYSTEM, DEMO],
    next: 'c2',
  });
  expect(await readTenantCount(fake.transport.gateway, query)).toMatchObject({
    ok: true,
    data: { count: 1, capped: false },
  });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'name=ac&enabled=true',
    'name=ac&enabled=true',
  ]);
});

it('keeps a tenant with no display name as null', async () => {
  const bare = { ...tenantRecord, display_name: null };
  const fake = fakeTransport({ 'GET /console/api/admin/tenants/showcase': json(bare) });
  expect(dataOf(await readTenant(fake.transport.gateway, 'showcase'))).toEqual({
    ...SHOWCASE,
    displayName: null,
  });
});

it('creates a tenant, sending the display name only when there is one', async () => {
  const fake = fakeTransport({ 'POST /console/api/admin/tenants': json(tenantRecord, 201) });
  const created = await createTenant(fake.transport.gateway, {
    name: 'showcase',
    displayName: 'Showcase',
  });
  await createTenant(fake.transport.gateway, { name: 'showcase', displayName: '' });
  expect(dataOf(created)).toEqual(SHOWCASE);
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { name: 'showcase', display_name: 'Showcase' },
    { name: 'showcase' },
  ]);
});

it('finds a tenant by its exact name, not a longer one the prefix search also matches', async () => {
  const demoEu = { ...tenantList.items[1], name: 'demo-eu' };
  const fake = fakeTransport({
    'GET /console/api/admin/tenants': json({ items: [demoEu, ...tenantList.items] }),
  });
  expect(dataOf(await findTenant(fake.transport.gateway, 'demo'))).toEqual(DEMO);
  expect(fake.sent[0]?.search.get('name')).toBe('demo');

  const none = fakeTransport({ 'GET /console/api/admin/tenants': json({ items: [demoEu] }) });
  expect(await findTenant(none.transport.gateway, 'demo')).toMatchObject({ ok: true, data: null });
});

it('reads a tenant with its ETag, and amends it under If-Match', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/showcase': json(tenantRecord, 200, { etag: '"e1"' }),
    'PATCH /console/api/admin/tenants/showcase': json({ ...tenantRecord, enabled: false }, 200, {
      etag: '"e2"',
    }),
  });
  const read = await readTenant(fake.transport.gateway, 'showcase');
  expect(read).toMatchObject({ ok: true, etag: '"e1"' });
  expect(dataOf(read)).toEqual(SHOWCASE);
  expect(
    await amendTenant(fake.transport.gateway, 'showcase', { enabled: false }, '"e1"'),
  ).toMatchObject({ ok: true, etag: '"e2"', data: { enabled: false } });
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"e1"', body: { enabled: false } });
});

it('clears an emptied display name rather than sending an empty one', async () => {
  const fake = fakeTransport({ 'PATCH /console/api/admin/tenants/showcase': json(tenantRecord) });
  await amendTenant(fake.transport.gateway, 'showcase', { display_name: '' }, '"e1"');
  await amendTenant(fake.transport.gateway, 'showcase', { display_name: 'Showcase' }, '"e1"');
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { display_name: null },
    { display_name: 'Showcase' },
  ]);
});

it('imports a document under a new name', async () => {
  const fake = fakeTransport({ 'POST /console/api/admin/tenant-imports': json(tenantImport, 201) });
  const result = await importTenant(fake.transport.gateway, {
    name: 'import-demo2',
    displayName: '',
    document: { version: 1 },
  });
  expect(dataOf(result)).toEqual({
    tenant: {
      name: 'import-demo2',
      displayName: 'Import demo',
      enabled: true,
      createdAt: '2026-10-30T05:48:10.004Z',
    },
    secrets: [{ clientId: 'billing-app', secret: tenantImport.client_secrets[0]?.secret }],
  });
  expect(fake.sent[0]?.body).toEqual({ name: 'import-demo2', document: { version: 1 } });
});

it('reads an export as the text the server sent, with or without subjects', async () => {
  const text = '{"version":1,"unknown_to_the_console":true,"omitted":[]}';
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/export': () =>
      new Response(text, { headers: { 'content-type': 'application/vnd.odudu.tenant+json' } }),
  });
  expect(await readExport(fake.transport.gateway, 'acme', false)).toMatchObject({
    ok: true,
    data: { text, contentType: 'application/vnd.odudu.tenant+json' },
  });
  await readExport(fake.transport.gateway, 'acme', true);
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['', 'include=subjects']);
});

it('encodes a tenant name that needs it, to read and to amend', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/a%20b%2Fc': json(tenantRecord),
    'PATCH /console/api/admin/tenants/a%20b%2Fc': json(tenantRecord),
  });
  expect(await readTenant(fake.transport.gateway, 'a b/c')).toMatchObject({ ok: true });
  expect(
    await amendTenant(fake.transport.gateway, 'a b/c', { enabled: false }, '"t1"'),
  ).toMatchObject({ ok: true });
});

it("reads the system tenant's issuer from its discovery document", async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/system/discovery': json({
      issuer: 'https://id.example/tenants/system',
      token_endpoint: 'x',
    }),
  });
  expect(await readSystemIssuer(fake.transport.gateway)).toMatchObject({
    ok: true,
    data: 'https://id.example/tenants/system',
  });
});

it('deletes a tenant by its name, which it names again as the confirmation', async () => {
  const fake = fakeTransport({
    'DELETE /console/api/admin/tenants/acme-eu': () => new Response(null, { status: 204 }),
  });
  expect(await deleteTenant(fake.transport.gateway, 'acme-eu')).toMatchObject({ ok: true });
  expect(fake.sent.map((sent) => [sent.method, sent.path, sent.search.toString()])).toEqual([
    ['DELETE', '/console/api/admin/tenants/acme-eu', 'confirm=acme-eu'],
  ]);
});
