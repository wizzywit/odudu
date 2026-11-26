import { ASSISTANT_SETTING_DEFAULTS, type AssistantSettings } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { type AssistantChatPort } from '#/view/routes/assistant';

let fixture: AdminFixture | undefined;
// The settings the fake store holds, by tenant id; none means every default.
const held = new Map<string, AssistantSettings>();
const reached: string[] = [];

function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

const chat: AssistantChatPort = {
  create: () => {
    reached.push('create');
    return Promise.resolve({ kind: 'unknown_profile' });
  },
  load: () => {
    reached.push('load');
    return Promise.resolve(null);
  },
  send: () => {
    reached.push('send');
    return Promise.resolve({ kind: 'not_found' });
  },
  stop: () => {
    reached.push('stop');
    return Promise.resolve('not_found');
  },
};

beforeAll(async () => {
  fixture = await startAdminFixture({
    assistantChat: chat,
    assistantSettings: {
      read: (_tx, tenantId) => Promise.resolve(held.get(tenantId) ?? ASSISTANT_SETTING_DEFAULTS),
      write: (_tx, tenantId, settings) => {
        held.set(tenantId, settings);
        return Promise.resolve();
      },
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

  it('serve a system administrator who holds manage-tenants and the capability, for another tenant', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().systemAdminToken(['manage-assistant', 'manage-tenants']);
    for (const method of ['GET', 'PUT'] as const) {
      expect((await call(method, tenant.name, token)).statusCode, method).toBe(200);
    }
  });

  it('refuse a system administrator without manage-tenants', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().systemAdminToken(['manage-assistant']);
    expect((await call('GET', tenant.name, token)).statusCode).toBe(403);
  });
});

describe('the chat routes for a tenant that turned the assistant off', () => {
  async function tenantWith(enabled: boolean) {
    const tenant = await fx().createTenant(`as-${newId()}`);
    held.set(tenant.id, { ...ASSISTANT_SETTING_DEFAULTS, assistant_enabled: enabled });
    const token = await fx().adminToken(tenant.name, ['use-assistant']);
    return { tenant, token };
  }

  function chatCall(
    tenant: string,
    token: string,
    method: 'POST' | 'GET',
    tail: string,
    payload?: unknown,
  ) {
    return fx().http.inject({
      method,
      url: `/admin/tenants/${tenant}/assistant/conversations${tail}`,
      headers:
        payload === undefined
          ? { authorization: `Bearer ${token}` }
          : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  }

  const CREATE = { page_context: { route: '/subjects' } };
  const SEND = { message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] } };

  it('answers create and send as a path never served, and never reaches the model side', async () => {
    const { tenant, token } = await tenantWith(false);
    reached.length = 0;
    const id = newId();
    const created = await chatCall(tenant.name, token, 'POST', '', CREATE);
    const sent = await chatCall(tenant.name, token, 'POST', `/${id}/messages`, SEND);
    expect(created.statusCode).toBe(404);
    expect(sent.statusCode).toBe(404);
    expect(created.json()).toMatchObject({ status: 404, title: 'Not Found' });
    expect(reached).toEqual([]);
  });

  it('still lets a person read and stop what they already have', async () => {
    const { tenant, token } = await tenantWith(false);
    reached.length = 0;
    const id = newId();
    await chatCall(tenant.name, token, 'GET', `/${id}`);
    await chatCall(tenant.name, token, 'POST', `/${id}/stop`);
    expect(reached).toEqual(['load', 'stop']);
  });

  it('reaches the model side for a tenant that left it on', async () => {
    const { tenant, token } = await tenantWith(true);
    reached.length = 0;
    await chatCall(tenant.name, token, 'POST', '', CREATE);
    await chatCall(tenant.name, token, 'POST', `/${newId()}/messages`, SEND);
    expect(reached).toEqual(['create', 'send']);
  });
});
