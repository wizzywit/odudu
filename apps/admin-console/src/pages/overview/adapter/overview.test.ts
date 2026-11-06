import { expect, it } from 'vitest';
import {
  readCount,
  readJwks,
  readLatestAudit,
  readOperatorClientCount,
} from '#/pages/overview/adapter/overview';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { TRANSCRIPT_JWKS } from '#/testing/overviewFixtures';

it("reads the tenant's JWKS through the gateway", async () => {
  const jwks = { keys: [{ kty: 'EC', kid: 'k1', alg: 'ES256', use: 'sig', crv: 'P-256' }] };
  const fake = fakeTransport({ 'GET /console/api/tenants/acme/jwks': json(jwks) });
  expect(await readJwks(fake.transport.gateway, 'acme')).toMatchObject({ ok: true, data: jwks });
});

it("reads a running server's JWKS, keeping the key's members the page does not read", async () => {
  const fake = fakeTransport({ 'GET /console/api/tenants/acme/jwks': json(TRANSCRIPT_JWKS) });
  expect(await readJwks(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: TRANSCRIPT_JWKS,
  });
});

it('counts each collection at its own route', async () => {
  const count = json({ count: 3, capped: false });
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/subjects/count': count,
    'GET /console/api/admin/tenants/acme/clients/count': count,
    'GET /console/api/admin/tenants/acme/groups/count': count,
    'GET /console/api/admin/tenants/acme/roles/count': count,
    'GET /console/api/admin/tenants/acme/scopes/count': count,
  });
  for (const collection of ['subjects', 'clients', 'groups', 'roles', 'scopes'] as const) {
    expect(await readCount(fake.transport.gateway, 'acme', collection)).toMatchObject({
      ok: true,
      data: { count: 3, capped: false },
    });
  }
  expect(fake.calls.map((call) => call.path)).toEqual([
    '/console/api/admin/tenants/acme/subjects/count',
    '/console/api/admin/tenants/acme/clients/count',
    '/console/api/admin/tenants/acme/groups/count',
    '/console/api/admin/tenants/acme/roles/count',
    '/console/api/admin/tenants/acme/scopes/count',
  ]);
});

it('counts the clients max_clients counts with a filter on the clients route', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/clients/count': (request) =>
      json(
        request.search.get('counts_toward_max_clients') === 'true'
          ? { count: 2, capped: false }
          : { count: 900, capped: false },
      )(request),
  });
  expect(await readOperatorClientCount(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { count: 2, capped: false },
  });
});

it('reads the five latest audit rows', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/audit': json({ items: [] }),
  });
  expect(await readLatestAudit(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: [],
  });
  expect(fake.sent[0]?.search.toString()).toBe('limit=5');
});
