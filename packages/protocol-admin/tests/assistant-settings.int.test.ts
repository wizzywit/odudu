import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixture: AdminFixture | undefined;

function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

beforeAll(async () => {
  fixture = await startAdminFixture({
    assistantSettings: {
      read: () => Promise.resolve(ASSISTANT_SETTING_DEFAULTS),
      write: () => Promise.resolve(),
    },
  });
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

function call(method: 'GET' | 'PUT', tenant: string, token: string) {
  return fx().http.inject({
    method,
    url: `/admin/tenants/${tenant}/assistant/settings`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(method === 'PUT' ? { payload: JSON.stringify(ASSISTANT_SETTING_DEFAULTS) } : {}),
  });
}

describe('the assistant settings routes', () => {
  it('serve an administrator of the tenant itself', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['manage-assistant']);
    expect((await call('GET', tenant.name, token)).statusCode).toBe(200);
    expect((await call('PUT', tenant.name, token)).statusCode).toBe(200);
  });

  it('are not served to a system administrator reaching into another tenant, as a chat call is not', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().systemAdminToken(['manage-assistant', 'manage-tenants']);
    for (const method of ['GET', 'PUT'] as const) {
      const res = await call(method, tenant.name, token);
      expect(res.statusCode, method).toBe(404);
      expect(res.json()).toMatchObject({ detail: 'No resource at this path' });
    }
  });
});
