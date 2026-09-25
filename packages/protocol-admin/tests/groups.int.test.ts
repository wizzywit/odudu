import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  amendGroup,
  createGroup,
  deleteGroup,
  setGroupRoles,
  type GroupAuditEvent,
} from '#/usecase/groups';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

function createGroupHttp(token: string, tenantName: string, body: Record<string, unknown>) {
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

describe('POST /admin/tenants/{t}/groups', () => {
  it('creates a root group that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const name = `engineering-${newId()}`;

    const res = await createGroupHttp(token, t.name, { name });
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
    const parent = (await createGroupHttp(token, t.name, { name: `eng-${newId()}` })).json<{
      id: string;
      path: string;
    }>();

    const res = await createGroupHttp(token, t.name, {
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

    const first = await createGroupHttp(token, t.name, { name });
    expect(first.statusCode).toBe(201);
    const second = await createGroupHttp(token, t.name, { name });
    expect(second.statusCode).toBe(409);
  });

  it('400s a parent_id naming no group', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await createGroupHttp(token, t.name, { name: 'x', parent_id: newId() });
    expect(res.statusCode).toBe(400);
  });

  it('is refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const capability of ['view-users', 'manage-users', 'manage-clients']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await createGroupHttp(token, t.name, { name: `x-${newId()}` });
      expect(res.statusCode, capability).toBe(403);
    }
  });
});

describe('GET /admin/tenants/{t}/groups/{id}', () => {
  it('returns the group with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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
    const a = (await createGroupHttp(token, t.name, { name: aName })).json<{ id: string }>();
    const b = (await createGroupHttp(token, t.name, { name: `b-${newId()}` })).json<{
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
    const parent = (await createGroupHttp(token, t.name, { name: `p-${newId()}` })).json<{
      id: string;
    }>();
    const child = (
      await createGroupHttp(token, t.name, { name: `c-${newId()}`, parent_id: parent.id })
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
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
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

describe('is refused for every capability but manage-tenant, on every route', () => {
  it('GET /groups, GET /groups/:id, PATCH /groups/:id, DELETE /groups/:id, PUT roles', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroupHttp(adminToken, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();
    const role = await plainRole(t.id);

    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

      const list = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/groups`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.statusCode, `GET /groups as ${capability}`).toBe(403);

      const read = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/groups/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(read.statusCode, `GET /groups/:id as ${capability}`).toBe(403);

      const amend = await fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/groups/${id}`,
        headers,
        payload: { parent_id: null },
      });
      expect(amend.statusCode, `PATCH /groups/:id as ${capability}`).toBe(403);

      const setRoles = await fixture.http.inject({
        method: 'PUT',
        url: `/admin/tenants/${t.name}/groups/${id}/roles`,
        headers,
        payload: { role_ids: [role] },
      });
      expect(setRoles.statusCode, `PUT /groups/:id/roles as ${capability}`).toBe(403);

      const del = await fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/groups/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(del.statusCode, `DELETE /groups/:id as ${capability}`).toBe(403);
    }
  });
});

describe('PUT /admin/tenants/{t}/groups/{id}/roles — the capability ceiling', () => {
  it('refuses a manage-tenant-only caller mapping tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [tenantAdminId] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a composite that nests tenant-admin rather than naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();
    const nestedRoleId = await roleNestingTenantAdmin(t.id);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [nestedRoleId] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder map tenant-admin freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const { id } = (await createGroupHttp(token, t.name, { name: `g-${newId()}` })).json<{
      id: string;
    }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [tenantAdminId] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('PATCH /admin/tenants/{t}/groups/{id} — the reparent capability ceiling', () => {
  it('refuses reparenting under a group whose own roles reach tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const target = (await createGroupHttp(adminToken, t.name, { name: `target-${newId()}` })).json<{
      id: string;
    }>();
    const adminGroup = (
      await createGroupHttp(adminToken, t.name, { name: `admin-group-${newId()}` })
    ).json<{ id: string }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);
    await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${adminGroup.id}/roles`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { role_ids: [tenantAdminId] },
    });

    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${target.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { parent_id: adminGroup.id },
    });
    expect(res.statusCode).toBe(403);
  });

  // The escalation named in the review: the admin capability arrives
  // through a composite mapped to the target, and through an ancestor of
  // the group being reparented under, not the group itself — a name check
  // on the request body would miss both.
  it('refuses reparenting under a descendant of a group whose composite role reaches tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const target = (await createGroupHttp(adminToken, t.name, { name: `target-${newId()}` })).json<{
      id: string;
    }>();
    const adminAncestor = (
      await createGroupHttp(adminToken, t.name, { name: `admin-ancestor-${newId()}` })
    ).json<{ id: string }>();
    const newParent = (
      await createGroupHttp(adminToken, t.name, {
        name: `new-parent-${newId()}`,
        parent_id: adminAncestor.id,
      })
    ).json<{ id: string }>();
    const nestedRoleId = await roleNestingTenantAdmin(t.id);
    await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${adminAncestor.id}/roles`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { role_ids: [nestedRoleId] },
    });

    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${target.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { parent_id: newParent.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder reparent under an admin-mapped group freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const target = (await createGroupHttp(token, t.name, { name: `target-${newId()}` })).json<{
      id: string;
    }>();
    const adminGroup = (
      await createGroupHttp(token, t.name, { name: `admin-group-${newId()}` })
    ).json<{ id: string }>();
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);
    await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${adminGroup.id}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { role_ids: [tenantAdminId] },
    });

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/groups/${target.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { parent_id: adminGroup.id },
    });
    expect(res.statusCode).toBe(200);
  });
});

// Every usecase in this file takes `audit` as a dependency rather than
// calling a sink directly — the same seam #/usecase/subjects.ts uses —
// driven directly here so a mutation's exactly-once call and a refusal's
// zero calls are pinned without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: GroupAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: GroupAuditEvent) => Promise<void>;
  } {
    const events: GroupAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once when it creates a group', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      createGroup(
        tx,
        { audit },
        {
          tenantId: t.id,
          name: `audited-${newId()}`,
          parentId: null,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('group.create');
  });

  it('calls audit exactly once on a successful amendment, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const group = await withTenant(fixture.app.db, t.id, (tx) =>
      createGroup(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `g-${newId()}`,
          parentId: null,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    const ok = collector();
    const amended = await withTenant(fixture.app.db, t.id, (tx) =>
      amendGroup(
        tx,
        { audit: ok.audit },
        {
          groupId: group.id,
          values: { parent_id: null },
          ifMatch: undefined,
          callerCapabilities: new Set(),
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
      amendGroup(
        tx,
        { audit: refused.audit },
        {
          groupId: group.id,
          values: { name: 'renamed' },
          ifMatch: undefined,
          callerCapabilities: new Set(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('refused_field');
    expect(refused.events).toHaveLength(0);
  });

  it('does not call audit on a reparent refused by the capability ceiling', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const [group, adminGroup] = await withTenant(fixture.app.db, t.id, async (tx) => [
      await createGroup(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `g-${newId()}`,
          parentId: null,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
      await createGroup(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `admin-${newId()}`,
          parentId: null,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    ]);
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);
    // A real tenant-admin holder's `callerCapabilities` is already expanded
    // through role_composites by the composition root (effectiveRoles) —
    // tenant-admin composites every capability below, so the setup call
    // here has to hand it the same expanded set rather than the bare name.
    const setResult = await withTenant(fixture.app.db, t.id, (tx) =>
      setGroupRoles(
        tx,
        { audit: () => Promise.resolve() },
        {
          groupId: adminGroup.id,
          roleIds: [tenantAdminId],
          callerCapabilities: new Set([TENANT_ADMIN, ...TENANT_CAPABILITIES]),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(setResult.kind).toBe('ok');

    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      amendGroup(
        tx,
        { audit: refused.audit },
        {
          groupId: group.id,
          values: { parent_id: adminGroup.id },
          ifMatch: undefined,
          callerCapabilities: new Set(['manage-tenant']),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('capability_ceiling');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once on a successful delete, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const group = await withTenant(fixture.app.db, t.id, (tx) =>
      createGroup(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `g-${newId()}`,
          parentId: null,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteGroup(
        tx,
        { audit: ok.audit },
        {
          groupId: group.id,
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
      deleteGroup(
        tx,
        { audit: refused.audit },
        {
          groupId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once replacing roles, and not on a capability-ceiling refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const group = await withTenant(fixture.app.db, t.id, (tx) =>
      createGroup(
        tx,
        { audit: () => Promise.resolve() },
        {
          tenantId: t.id,
          name: `g-${newId()}`,
          parentId: null,
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
      setGroupRoles(
        tx,
        { audit: ok.audit },
        {
          groupId: group.id,
          roleIds: [plain],
          callerCapabilities: new Set(['manage-tenant']),
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
      setGroupRoles(
        tx,
        { audit: refused.audit },
        {
          groupId: group.id,
          roleIds: [tenantAdminId],
          callerCapabilities: new Set(['manage-tenant']),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('capability_ceiling');
    expect(refused.events).toHaveLength(0);
  });
});
