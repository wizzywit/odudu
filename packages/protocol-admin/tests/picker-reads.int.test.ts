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

// A user manager assigns roles and groups, so it can list what there is to
// assign — and nothing more of either than the list.
describe('the role and group lists a user manager picks from', () => {
  it.each(['view-users', 'manage-users'])('are readable with %s alone', async (capability) => {
    const t = await fixture.createTenant(`pick-${newId()}`);
    const token = await fixture.adminToken(t.name, [capability]);
    const get = (tail: string) =>
      fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}${tail}`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect((await get('/roles')).statusCode).toBe(200);
    expect((await get('/groups')).statusCode).toBe(200);
    expect((await get('/roles/count')).statusCode).toBe(403);
    expect((await get('/groups/count')).statusCode).toBe(403);
    const role = (await get('/roles')).json<{ items: { id: string }[] }>().items[0]?.id ?? '';
    expect((await get(`/roles/${role}`)).statusCode).toBe(403);
    expect((await get(`/roles/${role}/composites`)).statusCode).toBe(403);
  });

  it('are refused to a capability that assigns neither', async () => {
    const t = await fixture.createTenant(`pick-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
