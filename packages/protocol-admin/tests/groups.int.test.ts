import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
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

function createGroup(token: string, tenantName: string, body: Record<string, unknown>) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/groups`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: body,
  });
}

async function plainRole(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId, name: `plain-${newId()}` });
    return role.id;
  });
}

describe('POST /admin/tenants/{t}/groups', () => {
  it('creates a root group that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `engineering-${newId()}`;

    const res = await createGroup(token, t.name, { name });
    expect(res.statusCode).toBe(201);
    const created = res.json<{
      id: string;
      name: string;
      path: string;
      parent_id: string | null;
    }>();
    expect(created.path).toBe(`/${name}`);
    expect(created.parent_id).toBeNull();

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/groups`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json<{ items: { name: string }[] }>().items.map((g) => g.name)).toContain(name);
  });

  it('creates a child group with a path prefixed by its parent', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const parent = (await createGroup(token, t.name, { name: `eng-${newId()}` })).json<{
      id: string;
      path: string;
    }>();

    const res = await createGroup(token, t.name, {
      name: 'platform',
      parent_id: parent.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ path: string }>().path).toBe(`${parent.path}/platform`);
  });

  it('refuses a duplicate sibling name with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `dup-${newId()}`;

    const first = await createGroup(token, t.name, { name });
    expect(first.statusCode).toBe(201);
    const second = await createGroup(token, t.name, { name });
    expect(second.statusCode).toBe(409);
  });

  it('400s a parent_id naming no group', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await createGroup(token, t.name, { name: 'x', parent_id: newId() });
    expect(res.statusCode).toBe(400);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of ['view-users', 'manage-users', 'manage-clients']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await createGroup(token, t.name, { name: `x-${newId()}` });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/groups/{id}', () => {
  it('returns the group with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/groups/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no group holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/groups/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/tenants/{t}/groups/{id} — reparenting', () => {
  it('moves a group under a new parent, rewriting its path', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const aName = `a-${newId()}`;
    const a = (await createGroup(token, t.name, { name: aName })).json<{ id: string }>();
    const b = (await createGroup(token, t.name, { name: `b-${newId()}` })).json<{
      id: string;
      path: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${a.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { parent_id: b.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ path: string; parent_id: string | null }>();
    expect(body.path).toBe(`${b.path}/${aName}`);
    expect(body.parent_id).toBe(b.id);
  });

  it('refuses reparenting into its own descendant with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const parent = (await createGroup(token, t.name, { name: `p-${newId()}` })).json<{
      id: string;
    }>();
    const child = (
      await createGroup(token, t.name, { name: `c-${newId()}`, parent_id: parent.id })
    ).json<{ id: string }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${parent.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { parent_id: child.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses amending name, with a reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 412 when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale"',
      },
      payload: { parent_id: null },
    });
    expect(res.statusCode).toBe(412);
  });
});

describe('DELETE /admin/tenants/{t}/groups/{id}', () => {
  it('removes the group', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/groups/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/groups/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(404);
  });

  it('404s an id no group holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/groups/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /admin/tenants/{t}/groups/{id}/roles', () => {
  it('replaces the role set, and a removed role stops appearing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();
    const roleA = await plainRole(t.id);
    const roleB = await plainRole(t.id);

    const first = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [roleA] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleA]);

    const second = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [roleB] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleB]);
  });

  it('400s an unknown role id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroup(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [newId()] },
    });
    expect(res.statusCode).toBe(400);
  });
});
