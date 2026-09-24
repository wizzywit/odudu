import { withTenant } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository, TENANT_ADMIN } from '@odudu/domain-tenant';
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

// The role id a tenant's own admin client carries for a capability name —
// the same helper subjects.int.test.ts uses for the identical lookup.
async function capabilityRoleId(tenantId: string, name: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

// A role that composites to `tenant-admin` without itself being named
// `tenant-admin` — the ceiling has to catch this through role_composites,
// not through a name comparison on the request body.
async function roleNestingTenantAdmin(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const nested = await roleRepository(tx).create({ tenantId, name: `nests-admin-${newId()}` });
    const tenantAdminId = await capabilityRoleId(tenantId, TENANT_ADMIN);
    await roleRepository(tx).addComposite(nested.id, tenantAdminId);
    return nested.id;
  });
}

async function plainRole(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId, name: `plain-${newId()}` });
    return role.id;
  });
}

describe('POST /admin/tenants/{t}/roles', () => {
  it('creates a tenant role that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `member-${newId()}`;

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name, description: 'ordinary members' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; name: string; description: string | null }>();
    expect(created.name).toBe(name);
    expect(created.description).toBe('ordinary members');

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}` },
    });
    const items = list.json<{ items: { name: string }[] }>().items;
    expect(items.map((r) => r.name)).toContain(name);
  });

  it('creates a client-scoped role against a client_id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const adminClient = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byClientId(ADMIN_CLIENT_ID),
    );
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: `scoped-${newId()}`, client_id: adminClient.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ client_id: string | null }>().client_id).toBe(adminClient.id);
  });

  it('refuses a duplicate tenant-role name with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `dup-${newId()}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/roles`;

    const first = await fixture.http.inject({ method: 'POST', url, headers, payload: { name } });
    expect(first.statusCode).toBe(201);
    const second = await fixture.http.inject({ method: 'POST', url, headers, payload: { name } });
    expect(second.statusCode).toBe(409);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of ['view-users', 'manage-users', 'manage-clients', 'manage-sessions']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/roles`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { name: `x-${newId()}` },
      });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/roles/{id}', () => {
  it('returns the role with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no role holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/tenants/{t}/roles/{id}', () => {
  it('amends description', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { description: 'renamed purpose' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ description: string | null }>().description).toBe('renamed purpose');
  });

  it('refuses amending name, with a reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 412 when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale"',
      },
      payload: { description: 'x' },
    });
    expect(res.statusCode).toBe(412);
  });
});

describe('DELETE /admin/tenants/{t}/roles/{id}', () => {
  it('removes the role', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(404);
  });

  it('404s an id no role holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /admin/tenants/{t}/roles/{id}/composites', () => {
  it('adds a child composite for a tenant-admin holder', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${parentId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: manageUsersId },
    });
    expect(res.statusCode).toBe(204);
  });

  it('refuses a cycle with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const parentId = await plainRole(t.id);
    const childId = await plainRole(t.id);
    await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${parentId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: childId },
    });

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${childId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: parentId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses nesting a genuinely nested composite reaching tenant-admin, for a manage-tenant-only caller', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const parentId = await plainRole(t.id);
    const nestedAdminId = await roleNestingTenantAdmin(t.id);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${parentId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: nestedAdminId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder nest freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const parentId = await plainRole(t.id);
    const nestedAdminId = await roleNestingTenantAdmin(t.id);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${parentId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: nestedAdminId },
    });
    expect(res.statusCode).toBe(204);
  });

  it('404s a parent id no role holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const childId = await plainRole(t.id);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${newId()}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: childId },
    });
    expect(res.statusCode).toBe(404);
  });
});
