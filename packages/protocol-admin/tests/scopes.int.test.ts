import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clientScopeRepository,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  amendScope,
  createScope,
  deleteScope,
  setScopeRoles,
  unassignScopeFromClient,
  type ScopeAuditEvent,
} from '#/usecase/scopes';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function createScopeHttp(token: string, tenantName: string, body: Record<string, unknown>) {
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

// The role id a tenant's own admin client carries for a capability name —
// the same helper subjects.int.test.ts and roles.int.test.ts use for the
// identical lookup.
async function capabilityRoleId(tenantId: string, name: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

describe('POST /admin/tenants/{t}/scopes', () => {
  it('creates a scope with the include flags, then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `scope-${newId()}`;

    const res = await createScopeHttp(token, t.name, {
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

    const first = await createScopeHttp(token, t.name, { name });
    expect(first.statusCode).toBe(201);
    const second = await createScopeHttp(token, t.name, { name });
    expect(second.statusCode).toBe(409);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of ['view-users', 'manage-users', 'manage-clients']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await createScopeHttp(token, t.name, { name: `x-${newId()}` });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/scopes/{id}', () => {
  it('returns the scope with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const roleA = await plainRole(t.id);
    const roleB = await plainRole(t.id);

    const first = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: [roleA] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleA]);

    const second = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: [roleB] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([roleB]);
  });

  it('400s an unknown role id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: [newId()] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s a role id that is not an id at all, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: ['not-a-uuid'] },
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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

  // The route asks only for manage-tenant; GET /clients/:id asks for
  // manage-clients. Answering with the client's own representation here
  // would hand the weaker holder everything the stricter route guards.
  it('answers with the scope assignments alone, never the client configuration', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const client = await fixture.createConfidentialClient(t.name, {
      redirectUris: ['https://rp.example/cb'],
    });

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { assignment: 'default' },
    });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json<Record<string, unknown>>()).sort()).toEqual([
      'client_id',
      'scopes',
    ]);
    expect(res.payload).not.toContain('rp.example');
  });

  it('404s a scope id no scope holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${newId()}/clients/${client.id}`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { assignment: 'default' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a client id no client holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/clients/${newId()}`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { assignment: 'default' },
    });
    expect(res.statusCode).toBe(404);
  });
});

const VERIFIER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const AUTHORIZE_REDIRECT_URI = 'https://app.example/callback';

async function scopeIdByName(tenantId: string, name: string): Promise<string> {
  const scope = await withTenant(fixture.app.db, tenantId, (tx) =>
    clientScopeRepository(tx).byName(name),
  );
  if (scope === null) throw new Error(`fixture: no scope named ${JSON.stringify(name)}`);
  return scope.id;
}

describe('DELETE /admin/tenants/{t}/scopes/{id}/clients/{clientId}', () => {
  it('removes the assignment: GET /clients/:id no longer lists it, and /authorize refuses it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['authorization_code'],
      redirectUris: [AUTHORIZE_REDIRECT_URI],
    });
    // provisionClientDefaults (called by createConfidentialClient's own
    // client row) assigns the tenant's default vocabulary, openid included.
    const openidId = await scopeIdByName(t.id, 'openid');

    const authorizeUrl = () => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: AUTHORIZE_REDIRECT_URI,
        scope: 'openid',
        state: 'xyz',
        code_challenge: VERIFIER_CHALLENGE,
        code_challenge_method: 'S256',
      });
      return `/tenants/${t.name}/protocol/openid-connect/auth?${params.toString()}`;
    };

    const before = await fixture.http.inject({ url: authorizeUrl() });
    expect(before.statusCode).toBe(200);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${openidId}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const readScopes = read.json<{ scopes: { id: string }[] }>().scopes;
    expect(readScopes.find((s) => s.id === openidId)).toBeUndefined();

    const after = await fixture.http.inject({ url: authorizeUrl() });
    expect(after.statusCode).toBe(302);
    expect(after.headers.location).toContain('error=invalid_scope');
  });

  it('repeating the removal answers 404', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const client = await fixture.createConfidentialClient(t.name, {});
    const openidId = await scopeIdByName(t.id, 'openid');

    const first = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${openidId}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(204);

    const second = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${openidId}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(404);
  });

  it('404s a scope id no scope holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${newId()}/clients/${client.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s a client id no client holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const openidId = await scopeIdByName(t.id, 'openid');

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/scopes/${openidId}/clients/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const openidId = await scopeIdByName(t.id, 'openid');

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/scopes/${openidId}/clients/${client.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode, `DELETE /scopes/:id/clients/:id as ${capability}`).toBe(403);
    }
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
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
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
      headers: { 'if-match': '*', authorization: `Bearer ${token}` },
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

describe('PUT /admin/tenants/{t}/scopes/{id}/roles — the capability ceiling', () => {
  it('refuses a manage-tenant-only caller mapping tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: [tenantAdminId] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder map tenant-admin freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const { id } = (await createScopeHttp(token, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
      headers: {
        'if-match': '*',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { role_ids: [tenantAdminId] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('is refused for every capability but manage-tenant, on every route', () => {
  it('GET /scopes, GET /scopes/:id, PATCH /scopes/:id, DELETE /scopes/:id, PUT roles, PUT clients', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createScopeHttp(adminToken, t.name, { name: `s-${newId()}` })).json<{
      id: string;
    }>();
    const role = await plainRole(t.id);
    const client = await fixture.createConfidentialClient(t.name, {});

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

      const list = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/scopes`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.statusCode, `GET /scopes as ${capability}`).toBe(403);

      const read = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/scopes/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(read.statusCode, `GET /scopes/:id as ${capability}`).toBe(403);

      const amend = await fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/scopes/${id}`,
        headers,
        payload: { description: 'x' },
      });
      expect(amend.statusCode, `PATCH /scopes/:id as ${capability}`).toBe(403);

      const setRoles = await fixture.http.inject({
        method: 'PUT',
        url: `/admin/tenants/${t.name}/scopes/${id}/roles`,
        headers,
        payload: { role_ids: [role] },
      });
      expect(setRoles.statusCode, `PUT /scopes/:id/roles as ${capability}`).toBe(403);

      const assign = await fixture.http.inject({
        method: 'PUT',
        url: `/admin/tenants/${t.name}/scopes/${id}/clients/${client.id}`,
        headers,
        payload: { assignment: 'default' },
      });
      expect(assign.statusCode, `PUT /scopes/:id/clients/:id as ${capability}`).toBe(403);

      const del = await fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/scopes/${id}`,
        headers: { 'if-match': '*', authorization: `Bearer ${token}` },
      });
      expect(del.statusCode, `DELETE /scopes/:id as ${capability}`).toBe(403);
    }
  });
});

// Every usecase in this file takes `audit` as a dependency rather than
// calling a sink directly — the same seam #/usecase/subjects.ts uses —
// driven directly here so a mutation's exactly-once call and a refusal's
// zero calls are pinned without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: ScopeAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: ScopeAuditEvent) => Promise<void>;
  } {
    const events: ScopeAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once when it creates a scope', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      createScope(
        tx,
        { audit },
        {
          tenantId: t.id,
          name: `audited-${newId()}`,
          description: null,
          includeInIdToken: undefined,
          includeInAccessToken: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('scope.create');
  });

  it('calls audit exactly once on a successful amendment, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const scope = await withTenant(fixture.app.db, t.id, (tx) =>
      createScope(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `s-${newId()}`,
          description: null,
          includeInIdToken: undefined,
          includeInAccessToken: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    const ok = collector();
    const amended = await withTenant(fixture.app.db, t.id, (tx) =>
      amendScope(
        tx,
        { audit: ok.audit },
        {
          scopeId: scope.id,
          values: { description: 'x' },
          ifMatch: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(amended.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendScope(
        tx,
        { audit: refused.audit },
        {
          scopeId: scope.id,
          values: { name: 'renamed' },
          ifMatch: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('refused_field');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once on a successful delete, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const scope = await withTenant(fixture.app.db, t.id, (tx) =>
      createScope(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `s-${newId()}`,
          description: null,
          includeInIdToken: undefined,
          includeInAccessToken: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteScope(
        tx,
        { audit: ok.audit },
        {
          scopeId: scope.id,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(deleted.kind).toBe('deleted');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteScope(
        tx,
        { audit: refused.audit },
        {
          scopeId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once unassigning a scope from a client, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const scope = await withTenant(fixture.app.db, t.id, (tx) =>
      createScope(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `s-${newId()}`,
          description: null,
          includeInIdToken: undefined,
          includeInAccessToken: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    const client = await fixture.createConfidentialClient(t.name, {});
    await withTenant(fixture.app.db, t.id, (tx) =>
      clientScopeRepository(tx).assignOrUpdate(client.id, scope.id, 'default'),
    );

    const ok = collector();
    const removed = await withTenant(fixture.app.db, t.id, (tx) =>
      unassignScopeFromClient(
        tx,
        { audit: ok.audit },
        {
          scopeId: scope.id,
          clientId: client.id,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(removed.kind).toBe('removed');
    expect(ok.events).toHaveLength(1);
    expect(ok.events[0]?.action).toBe('scope.unassign_from_client');

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      unassignScopeFromClient(
        tx,
        { audit: refused.audit },
        {
          scopeId: scope.id,
          clientId: client.id,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_assigned');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once replacing roles, and not on a capability-ceiling refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const scope = await withTenant(fixture.app.db, t.id, (tx) =>
      createScope(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `s-${newId()}`,
          description: null,
          includeInIdToken: undefined,
          includeInAccessToken: undefined,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    const plain = await plainRole(t.id);
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const ok = collector();
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setScopeRoles(
        tx,
        { audit: ok.audit },
        {
          scopeId: scope.id,
          roleIds: [plain],
          callerCapabilities: new Set(['manage-tenant']),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(set.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      setScopeRoles(
        tx,
        { audit: refused.audit },
        {
          scopeId: scope.id,
          roleIds: [tenantAdminId],
          callerCapabilities: new Set(['manage-tenant']),
          ifMatch: '*',
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('capability_ceiling');
    // An attempted privilege escalation is the one refusal this phase
    // records, so the row is the assertion rather than its absence.
    expect(refused.events.map((event) => event.outcome)).toEqual(['refused']);
  });
});

async function seedNamed(tenantName: string, name: string): Promise<string> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  const res = await createScopeHttp(token, tenantName, { name });
  if (res.statusCode !== 201) throw new Error(`could not create scope ${name}: ${res.body}`);
  return res.json<{ id: string }>().id;
}

async function listAt(tenantName: string, query: string): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/scopes?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function namesOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { name: string }[] }>().items.map((item) => item.name);
}

// PostgreSQL's own answer, in the order a searched listing promises, so no
// expectation here folds a string in JavaScript.
async function nameMatches(tenantId: string, prefix: string): Promise<string[]> {
  const rows = await fixture.owner.db.execute<{ name: string }>(sql`
    select name from client_scopes
     where tenant_id = ${tenantId} and starts_with(lower(name), lower(${prefix}))
     order by lower(name) collate "C", id
  `);
  return rows.map((row) => row.name);
}

describe('GET /admin/tenants/{t}/scopes — search', () => {
  it('finds a name case-insensitively, ordered by the folded name, then by id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['Billing-c', 'BILLING-A', 'billing-b', 'Billing-a2', 'other']) {
      await seedNamed(t.name, name);
    }

    const res = await listAt(t.name, 'name=billing');
    expect(res.statusCode).toBe(200);
    const expected = await nameMatches(t.id, 'billing');
    expect(expected).toHaveLength(4);
    expect(namesOf(res)).toEqual(expected);
  });

  it('pages a name search one row at a time, each match once and in order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['ops-b', 'OPS-a', 'ops-c', 'other']) await seedNamed(t.name, name);

    const seen: string[] = [];
    let query = 'name=ops&limit=1';
    for (let page = 0; page < 5; page += 1) {
      const res = await listAt(t.name, query);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { name: string }[]; next?: string }>();
      seen.push(...body.items.map((item) => item.name));
      if (body.next === undefined) break;
      query = `name=ops&limit=1&cursor=${encodeURIComponent(body.next)}`;
    }
    expect(seen).toEqual(['OPS-a', 'ops-b', 'ops-c']);
  });

  it('reads _ and % as ordinary characters', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['axb', 'a_b', 'a%b']) await seedNamed(t.name, name);

    expect(namesOf(await listAt(t.name, 'name=a_b'))).toEqual(['a_b']);
    expect(namesOf(await listAt(t.name, 'name=a%25'))).toEqual(['a%b']);
  });

  it('finds nothing searching for a scope that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    await seedNamed(other.name, 'foreign-scope');

    const res = await listAt(t.name, 'name=foreign');
    expect(res.statusCode).toBe(200);
    expect(namesOf(res)).toEqual([]);
  });

  it('refuses an unknown parameter with 400 naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await listAt(t.name, 'search=a');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('search');
  });

  it.each([
    ['another search', 'name=a&limit=1', 'name=b&limit=1'],
    ['a filter added', 'limit=1', 'name=a&limit=1'],
    ['a filter dropped', 'name=a&limit=1', 'limit=1'],
  ])('refuses a cursor replayed under %s', async (_label, minted, replayedUnder) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['a-1', 'a-2', 'b-1', 'b-2']) await seedNamed(t.name, name);

    const first = await listAt(t.name, minted);
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listAt(t.name, `${replayedUnder}&cursor=${encodeURIComponent(next)}`);
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });
});

describe('the client_scopes name_search column', () => {
  it('is refused on create, filled by the database, and never answered', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const forged = await createScopeHttp(token, t.name, {
      name: 'Mixed-Case',
      name_search: 'forged',
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json<{ detail: string }>().detail).toContain('name_search');

    const res = await createScopeHttp(token, t.name, { name: 'Mixed-Case' });
    expect(res.statusCode).toBe(201);
    const created = res.json<Record<string, unknown>>();
    expect(created).not.toHaveProperty('name_search');

    const rows = await fixture.owner.db.execute<{ name_search: string }>(
      sql`select name_search from client_scopes where id = ${String(created.id)}`,
    );
    expect(rows.map((row) => row.name_search)).toEqual(['mixed-case']);

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/scopes/${String(created.id)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<Record<string, unknown>>()).not.toHaveProperty('name_search');
  });

  it('is refused by PATCH with a reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await seedNamed(t.name, `x-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name_search: 'forged' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('name_search');
  });
});
