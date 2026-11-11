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

async function setup() {
  const t = await fixture.createTenant(`me-${newId()}`);
  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
  const client = await fixture.createConfidentialClient(t.name, {});
  const ids = new Map<string, string>();
  for (const name of ['me:read', 'me:write']) {
    const [row] = await fixture.owner.sql<{ id: string }[]>`
      select id from client_scopes where tenant_id = ${t.id} and name = ${name}`;
    ids.set(name, row?.id ?? '');
  }
  const url = (scope: string) =>
    `/admin/tenants/${t.name}/scopes/${ids.get(scope) ?? ''}/clients/${client.id}`;
  const put = (scope: string) =>
    fixture.http.inject({
      method: 'PUT',
      url: url(scope),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { assignment: 'optional' },
    });
  const del = (scope: string) =>
    fixture.http.inject({
      method: 'DELETE',
      url: url(scope),
      headers: { authorization: `Bearer ${token}` },
    });
  return { put, del };
}

const MESSAGE = 'the scope me:write is held only together with me:read';

describe('me:write on a client', () => {
  it('is refused without me:read, naming the rule', async () => {
    const { put } = await setup();
    const res = await put('me:write');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toBe(MESSAGE);
  });

  it('is accepted once me:read is held', async () => {
    const { put } = await setup();
    expect((await put('me:read')).statusCode).toBe(200);
    expect((await put('me:write')).statusCode).toBe(200);
  });

  it('keeps me:read from being removed while me:write is held', async () => {
    const { put, del } = await setup();
    await put('me:read');
    await put('me:write');
    const res = await del('me:read');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toBe(MESSAGE);
    expect((await del('me:write')).statusCode).toBe(204);
    expect((await del('me:read')).statusCode).toBe(204);
  });
});
