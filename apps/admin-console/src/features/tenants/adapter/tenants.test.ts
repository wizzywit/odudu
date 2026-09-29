import { expect, it } from 'vitest';
import {
  amendTenant,
  createTenant,
  findTenant,
  importTenant,
  readExport,
  readSystemIssuer,
  readTenant,
  readTenantCount,
  readTenantPage,
} from '#/features/tenants/adapter/tenants.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const ACME = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  name: 'acme',
  display_name: 'Acme',
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};
const ACME_EU = { ...ACME, id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b5', name: 'acme-eu' };

it('lists and counts tenants with the query it is given', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants': json({ items: [ACME], next: 'c2' }),
    'GET /console/api/admin/tenants/count': json({ count: 1, capped: false }),
  });
  const query = new URLSearchParams({ name: 'ac', enabled: 'true' });
  expect(await readTenantPage(fake.transport.gateway, query)).toMatchObject({
    ok: true,
    data: { items: [ACME], next: 'c2' },
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

it('creates a tenant, sending the display name only when there is one', async () => {
  const fake = fakeTransport({ 'POST /console/api/admin/tenants': json(ACME, 201) });
  await createTenant(fake.transport.gateway, { name: 'acme', displayName: 'Acme' });
  await createTenant(fake.transport.gateway, { name: 'acme', displayName: '' });
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { name: 'acme', display_name: 'Acme' },
    { name: 'acme' },
  ]);
});

it('finds a tenant by its exact name, not a longer one the prefix search also matches', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants': json({ items: [ACME_EU, ACME] }),
  });
  expect(await findTenant(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: ACME,
  });
  expect(fake.sent[0]?.search.get('name')).toBe('acme');

  const none = fakeTransport({ 'GET /console/api/admin/tenants': json({ items: [ACME_EU] }) });
  expect(await findTenant(none.transport.gateway, 'acme')).toMatchObject({ ok: true, data: null });
});

it('reads a tenant with its ETag, and amends it under If-Match', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme': json(ACME, 200, { etag: '"e1"' }),
    'PATCH /console/api/admin/tenants/acme': json({ ...ACME, enabled: false }, 200, {
      etag: '"e2"',
    }),
  });
  expect(await readTenant(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    etag: '"e1"',
  });
  expect(
    await amendTenant(fake.transport.gateway, 'acme', { enabled: false }, '"e1"'),
  ).toMatchObject({ ok: true, etag: '"e2"', data: { enabled: false } });
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"e1"', body: { enabled: false } });
});

it('imports a document under a new name', async () => {
  const answer = { tenant: ACME, client_secrets: [{ client_id: 'web', secret: 's3cr3t' }] };
  const fake = fakeTransport({ 'POST /console/api/admin/tenant-imports': json(answer, 201) });
  const result = await importTenant(fake.transport.gateway, {
    name: 'acme',
    displayName: '',
    document: { version: 1 },
  });
  expect(result).toMatchObject({ ok: true, data: answer });
  expect(fake.sent[0]?.body).toEqual({ name: 'acme', document: { version: 1 } });
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
