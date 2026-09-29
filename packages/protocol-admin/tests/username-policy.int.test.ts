import { withTenant } from '@odudu/db';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { readUsernamePolicy } from '#/usecase/subjects';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function readPolicy(tenantName: string, token: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/subjects/username-policy`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function allowUsernameEditing(tenantName: string): Promise<void> {
  const res = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${tenantName}/settings`,
    headers: {
      authorization: `Bearer ${await fixture.adminToken(tenantName, ['manage-tenant'])}`,
      'content-type': 'application/json',
    },
    payload: { username_editable: true },
  });
  expect(res.statusCode).toBe(200);
}

describe('GET /admin/tenants/{t}/subjects/username-policy', () => {
  it('answers the tenant’s setting to a view-users holder, with no ETag', async () => {
    const t = await fixture.createTenant(`policy-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const off = await readPolicy(t.name, token);
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ username_editable: false });
    expect(off.headers.etag).toBeUndefined();

    await allowUsernameEditing(t.name);
    expect((await readPolicy(t.name, token)).json()).toEqual({ username_editable: true });
  });

  it('answers the target tenant’s own setting, not the caller’s', async () => {
    const t = await fixture.createTenant(`policy-target-${newId()}`);
    const u = await fixture.createTenant(`policy-other-${newId()}`);
    await allowUsernameEditing(u.name);
    const token = await fixture.systemAdminToken(['manage-tenants', 'view-users']);

    expect((await readPolicy(t.name, token)).json()).toEqual({ username_editable: false });
    expect((await readPolicy(u.name, token)).json()).toEqual({ username_editable: true });
  });

  it('refuses another tenant’s administrator with 401', async () => {
    const t = await fixture.createTenant(`policy-foreign-${newId()}`);
    const u = await fixture.createTenant(`policy-caller-${newId()}`);
    const token = await fixture.adminToken(u.name, ['view-users']);
    expect((await readPolicy(t.name, token)).statusCode).toBe(401);
  });

  it.each(TENANT_CAPABILITIES.filter((c) => c !== 'view-users' && c !== 'manage-users'))(
    'refuses a caller holding only %s',
    async (capability) => {
      const t = await fixture.createTenant(`policy-403-${newId()}`);
      const token = await fixture.adminToken(t.name, [capability]);
      expect((await readPolicy(t.name, token)).statusCode).toBe(403);
    },
  );

  it('answers a manage-users holder, which nests view-users', async () => {
    const t = await fixture.createTenant(`policy-manage-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    expect((await readPolicy(t.name, token)).statusCode).toBe(200);
  });

  // `tenants` is keyed on `id` under RLS, so the probe is direct: in another
  // tenant's context the row is not there to read, and the answer is the
  // default rather than the other tenant's setting.
  it('reads nothing of another tenant’s settings from inside a tenant’s context', async () => {
    const a = await fixture.createTenant(`policy-a-${newId()}`);
    const b = await fixture.createTenant(`policy-b-${newId()}`);
    await allowUsernameEditing(a.name);
    expect(await withTenant(fixture.app.db, a.id, (tx) => readUsernamePolicy(tx, a.id))).toEqual({
      usernameEditable: true,
    });
    expect(await withTenant(fixture.app.db, b.id, (tx) => readUsernamePolicy(tx, a.id))).toEqual({
      usernameEditable: false,
    });
  });
});
