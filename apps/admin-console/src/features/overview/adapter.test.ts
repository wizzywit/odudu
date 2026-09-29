import { expect, it } from 'vitest';
import {
  readCount,
  readDiscovery,
  readJwks,
  readKeys,
  readLatestAudit,
  readSettings,
  readSmtp,
} from '#/features/overview/adapter.ts';
import { fakeTransport, inTurn, json } from '#/testing/fakeTransport.ts';

const DISCOVERY = {
  issuer: 'https://id.example/tenants/acme',
  token_endpoint: 'https://id.example/tenants/acme/protocol/openid-connect/token',
  grant_types_supported: ['authorization_code'],
  something_new: { kept: true },
};

it("reads the tenant's discovery document through the gateway, keeping what it does not know", async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/acme/discovery': json(DISCOVERY),
  });
  const result = await readDiscovery(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: DISCOVERY });
});

it('refuses a discovery document with no issuer', async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/acme/discovery': json({ token_endpoint: 'x' }),
  });
  expect(await readDiscovery(fake.transport.gateway, 'acme')).toEqual({
    ok: false,
    kind: 'schema',
  });
});

it("reads the tenant's JWKS through the gateway", async () => {
  const jwks = { keys: [{ kty: 'EC', kid: 'k1', alg: 'ES256', use: 'sig', crv: 'P-256' }] };
  const fake = fakeTransport({ 'GET /console/api/tenants/acme/jwks': json(jwks) });
  expect(await readJwks(fake.transport.gateway, 'acme')).toMatchObject({ ok: true, data: jwks });
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

it('reads settings and the SMTP relay', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/settings': json({ verify_email: true, max_clients: 200 }),
    'GET /console/api/admin/tenants/acme/smtp': json({
      configured: false,
      host: null,
      port: null,
      from_address: null,
      username: null,
      password_set: false,
      starttls: null,
      effective: 'none',
    }),
  });
  expect(await readSettings(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { verify_email: true, max_clients: 200 },
  });
  expect(await readSmtp(fake.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { effective: 'none' },
  });
});

const KEY = {
  id: 'k1',
  status: 'active',
  kid: 'kid1',
  alg: 'ES256',
  created_at: '2026-09-01T00:00:00Z',
  not_after: null,
};

it('reads every signing key, following the cursor to the last page', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/keys': inTurn(
      json({ items: [KEY], next: 'c1' }),
      json({ items: [{ ...KEY, id: 'k2', status: 'rotating' }] }),
    ),
  });
  const result = await readKeys(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: [{ id: 'k1' }, { id: 'k2' }] });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'limit=200',
    'limit=200&cursor=c1',
  ]);
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

it('gives up, and says so, on a key list whose cursor never ends', async () => {
  const fake = fakeTransport({
    'GET /console/api/admin/tenants/acme/keys': json({ items: [KEY], next: 'again' }),
  });
  const logged: string[] = [];
  const result = await readKeys(fake.transport.gateway, 'acme', (message) => {
    logged.push(message);
  });
  expect(result).toEqual({ ok: false, kind: 'defect' });
  expect(fake.calls).toHaveLength(10);
  expect(logged).toEqual(['console defect: GET keys of acme still had a next page after 10 pages']);
});
