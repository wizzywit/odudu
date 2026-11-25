import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const CIBA = 'urn:openid:params:grant-type:ciba';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('the CIBA grant on a client', () => {
  async function create(authMethod: string) {
    const tenant = await fixture.createTenant(`ciba-${newId()}`);
    const token = await fixture.adminToken(tenant.name, ['manage-clients']);
    return {
      tenant,
      token,
      res: await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${tenant.name}/clients`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: {
          client_id: `agent-${newId()}`,
          redirect_uris: ['https://app.example/callback'],
          token_endpoint_auth_method: authMethod,
          grant_types: [CIBA],
        },
      }),
    };
  }

  it('[ODUDU-CIBA-CONF-04] is accepted for a confidential client', async () => {
    expect((await create('client_secret_basic')).res.statusCode).toBe(201);
  });

  it('[ODUDU-CIBA-CONF-05] is refused for a public client', async () => {
    const { res } = await create('none');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/needs a client that authenticates/u);
  });

  it('[ODUDU-CIBA-CONF-06] is refused when added to a public client', async () => {
    const tenant = await fixture.createTenant(`ciba-${newId()}`);
    const token = await fixture.adminToken(tenant.name, ['manage-clients']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const clientId = `spa-${newId()}`;
    const made = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenant.name}/clients`,
      headers,
      payload: {
        client_id: clientId,
        redirect_uris: ['https://app.example/callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(made.statusCode).toBe(201);
    const current = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${tenant.name}/clients/${made.json<{ id: string }>().id}`,
      headers,
    });
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${tenant.name}/clients/${made.json<{ id: string }>().id}`,
      headers: { ...headers, 'if-match': String(current.headers.etag) },
      payload: { grant_types: ['authorization_code', CIBA] },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json<{ detail: string }>().detail).toMatch(/needs a client that authenticates/u);
  });
});
