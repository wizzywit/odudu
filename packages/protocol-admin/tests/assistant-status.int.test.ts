import { type AssistantStatus } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const ENABLED: AssistantStatus = {
  enabled: true,
  slots: { fast: 'small', standard: 'mid', deep: 'big' },
  modes: ['ask', 'act'],
  defaultMode: 'ask',
  modelChoices: ['small', 'mid', 'big'],
  provider: { kind: 'openai-compatible', host: 'gpu.internal:8000' },
};

let answer: AssistantStatus = { enabled: false };
let fixture: AdminFixture | undefined;

function fx(): AdminFixture {
  if (fixture === undefined) throw new Error('fixture not started');
  return fixture;
}

beforeAll(async () => {
  fixture = await startAdminFixture({ assistantStatus: () => answer });
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

function get(tenant: string, tail: string, token?: string) {
  return fx().http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/assistant${tail}`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe('GET /admin/tenants/:tenant/assistant/status', () => {
  it('answers { enabled: false } to a caller holding use-assistant when no model is configured', async () => {
    answer = { enabled: false };
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['use-assistant']);
    const res = await get(tenant.name, '/status', token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
  });

  it('answers what the process resolved to a caller holding use-assistant', async () => {
    answer = ENABLED;
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['use-assistant']);
    const res = await get(tenant.name, '/status', token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual(ENABLED);
  });

  it('refuses a caller without use-assistant, whether or not a model is configured', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().adminToken(tenant.name, ['view-users', 'read-assistant-activity']);
    for (const configured of [ENABLED, { enabled: false } as const]) {
      answer = configured;
      expect((await get(tenant.name, '/status', token)).statusCode).toBe(403);
    }
  });

  it('refuses a request with no token', async () => {
    const tenant = await fx().createTenant(`as-${newId()}`);
    expect((await get(tenant.name, '/status')).statusCode).toBe(401);
  });
});

describe('the rest of the assistant path', () => {
  it('answers 404, not 403, for a route that is not served, to a caller holding every capability', async () => {
    answer = { enabled: false };
    const tenant = await fx().createTenant(`as-${newId()}`);
    const token = await fx().adminToken(tenant.name, [
      'use-assistant',
      'read-assistant-activity',
      'manage-assistant',
    ]);
    for (const tail of ['/conversations', '/settings', '/activity']) {
      expect((await get(tenant.name, tail, token)).statusCode, tail).toBe(404);
    }
  });
});
