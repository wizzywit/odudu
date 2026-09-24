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

function createScope(token: string, tenantName: string, body: Record<string, unknown>) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/scopes`,
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

describe('POST /admin/tenants/{t}/scopes', () => {
  it('creates a scope with the include flags, then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `scope-${newId()}`;

    const res = await createScope(token, t.name, {
      name,
      include_in_id_token: false,
      include_in_access_token: true,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{
      id: string;
      name: string;
      include_in_id_token: boolean;
      include_in_access_token: boolean;
    }>();
    expect(created.include_in_id_token).toBe(false);
    expect(created.include_in_access_token).toBe(true);

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json<{ items: { name: string }[] }>().items.map((s) => s.name)).toContain(name);
  });

  it('refuses a duplicate name with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `dup-${newId()}`;

    const first = await createScope(token, t.name, { name });
    expect(first.statusCode).toBe(201);
    const second = await createScope(token, t.name, { name });
    expect(second.statusCode).toBe(409);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of ['view-users', 'manage-users', 'manage-clients']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await createScope(token, t.name, { name: `x-${newId()}` });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/scopes/{id}', () => {
  it('returns the scope with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no scope holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/scopes/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/tenants/{t}/scopes/{id}', () => {
  it('amends description and the include flags', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { description: 'profile claims', include_in_id_token: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ description: string | null; include_in_id_token: boolean }>();
    expect(body.description).toBe('profile claims');
    expect(body.include_in_id_token).toBe(false);
  });

  it('refuses amending name, with a reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 412 when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
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

describe('PUT /admin/tenants/{t}/scopes/{id}/roles', () => {
  it('replaces the role set, and a removed role stops appearing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const roleA = await plainRole(t.id);
    const roleB = await plainRole(t.id);

    const first = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [roleA] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleA]);

    const second = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [roleB] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleB]);
  });

  it('400s an unknown role id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [newId()] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /admin/tenants/{t}/scopes/{id}/clients/{clientId}', () => {
  it('assigns the scope to a client as default, visible in the client read', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    // Reading the client back (below) needs manage-clients too — assigning
    // the scope itself only needs manage-tenant.
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { assignment: 'default' },
    });
    expect(res.statusCode).toBe(200);
    const scopes = res.json<{ scopes: { id: string; assignment: string }[] }>().scopes;
    expect(scopes.find((s) => s.id === id)?.assignment).toBe('default');

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const readScopes = read.json<{ scopes: { id: string; assignment: string }[] }>().scopes;
    expect(readScopes.find((s) => s.id === id)?.assignment).toBe('default');
  });

  it('re-assigning narrows default to optional rather than duplicating the row', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const client = await fixture.createConfidentialClient(t.name, {});
    const url = `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    await fixture.http.inject({ method: 'PUT', url, headers, payload: { assignment: 'default' } });
    const res = await fixture.http.inject({
      method: 'PUT',
      url,
      headers,
      payload: { assignment: 'optional' },
    });
    expect(res.statusCode).toBe(200);
    const scopes = res.json<{ scopes: { id: string; assignment: string }[] }>().scopes;
    const matching = scopes.filter((s) => s.id === id);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.assignment).toBe('optional');
  });

  it('404s a scope id no scope holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${newId()}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { assignment: 'default' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a client id no client holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${newId()}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { assignment: 'default' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// client_scope_assignments_scope_fk and client_scope_roles_scope_fk
// (packages/db/drizzle/0016_client_scopes.sql, 0017_roles.sql) both name
// ON DELETE CASCADE, not RESTRICT — so deleting an assigned, role-mapped
// scope removes it and both dependent rows together, never refusing.
describe('DELETE /admin/tenants/{t}/scopes/{id} — cascades to its assignment and role mapping', () => {
  it('removes the scope, its client assignment and its role mapping together', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    // Reading the client back (below) needs manage-clients too.
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const { id } = (await createScope(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const client = await fixture.createConfidentialClient(t.name, {});
    const role = await plainRole(t.id);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`,
      headers,
      payload: { assignment: 'default' },
    });
    await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers,
      payload: { role_ids: [role] },
    });

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const clientRead = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const clientScopes = clientRead.json<{ scopes: { id: string }[] }>().scopes;
    expect(clientScopes.find((s) => s.id === id)).toBeUndefined();
  });

  it('404s an id no scope holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
