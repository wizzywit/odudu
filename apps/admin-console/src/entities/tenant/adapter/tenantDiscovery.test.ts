import { expect, it } from 'vitest';
import { discoverySchema, readDiscovery } from '#/entities/tenant/adapter/tenantDiscovery';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { TRANSCRIPT_DISCOVERY } from '#/testing/overviewFixtures';

const DISCOVERY = {
  issuer: 'https://id.example/tenants/acme',
  token_endpoint: 'https://id.example/tenants/acme/protocol/openid-connect/token',
  grant_types_supported: ['authorization_code'],
  something_new: { kept: true },
};

it('holds a discovery document to its issuer and keeps the rest', () => {
  expect(discoverySchema.parse({ issuer: 'https://x', extra: 1 })).toEqual({
    issuer: 'https://x',
    extra: 1,
  });
  expect(discoverySchema.safeParse({}).success).toBe(false);
});

it("reads the tenant's discovery document through the gateway, keeping what it does not know", async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/acme/discovery': json(DISCOVERY),
  });
  const result = await readDiscovery(fake.transport.gateway, 'acme');
  expect(result).toMatchObject({ ok: true, data: DISCOVERY });
});

it('encodes the tenant in the path', async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/acme%20corp/discovery': json(DISCOVERY),
  });
  expect(await readDiscovery(fake.transport.gateway, 'acme corp')).toMatchObject({ ok: true });
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

it("reads a running server's discovery document whole", async () => {
  const fake = fakeTransport({
    'GET /console/api/tenants/system/discovery': json(TRANSCRIPT_DISCOVERY),
  });
  expect(await readDiscovery(fake.transport.gateway, 'system')).toMatchObject({
    ok: true,
    data: TRANSCRIPT_DISCOVERY,
  });
});
