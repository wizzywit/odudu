import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { roleComposites, roleRepository, subjectRoles } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { and, eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  addRoleComposite,
  amendRole,
  createRole,
  deleteRole,
  type RoleAuditEvent,
} from '#/usecase/roles';

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

describe('POST /admin/tenants/{t}/roles with a client_id', () => {
  it('creates a role scoped to a client that exists', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const client = await fixture.createConfidentialClient(t.name, {});

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: `scoped-${newId()}`, client_id: client.id },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json<{ client_id: string }>().client_id).toBe(client.id);
  });

  // The insert would fail on roles_client_fk, which is not the unique
  // violation the route turns into a 409 — so it reached the error handler.
  it('refuses a client_id no client holds with 400, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: `scoped-${newId()}`, client_id: newId() },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toMatch(/client_id names no client/u);
  });

  it('refuses a client_id that is not an id at all with 400, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: `scoped-${newId()}`, client_id: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
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

  // subject_roles_role_fk cascades, so deleting one of these would strip it
  // from every administrator holding it — including from the caller, and
  // including tenant-admin itself, which manage-tenant alone must not be
  // able to reach.
  it('refuses to delete tenant-admin, and leaves every holder with it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await capabilityRoleId(t.id, TENANT_ADMIN);
    // Minting the token is what puts a holder on the role, so the cascade
    // this refusal prevents has something to have stripped.
    await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toMatch(/built-in/u);

    const holders = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(subjectRoles).where(eq(subjectRoles.roleId, id)),
    );
    expect(holders.length).toBeGreaterThan(0);
  });

  it('refuses to delete manage-tenant, the capability the caller is using', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await capabilityRoleId(t.id, 'manage-tenant');
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
  });

  it('still deletes a role an ordinary client owns', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const id = await withTenant(fixture.app.db, t.id, async (tx) => {
      const role = await roleRepository(tx).create({
        tenantId: t.id,
        name: `client-role-${newId()}`,
        clientId: client.id,
      });
      return role.id;
    });
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
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

describe('POST /admin/tenants/{t}/roles/{id}/composites — concurrent cycle race', () => {
  // Without a lock on both endpoints of the edge, two concurrent calls that
  // together close a cycle (A -> B while B -> A) can each pass
  // closureFrom's check before either commits, and both succeed — the
  // cycle the domain check exists to make impossible. Locking serialises
  // them: the second call's check runs against the first call's already-
  // committed edge.
  it('lets at most one of two concurrent calls that would close a cycle succeed', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const a = await plainRole(t.id);
    const b = await plainRole(t.id);

    const [first, second] = await Promise.all([
      fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/roles/${a}/composites`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { child_role_id: b },
      }),
      fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/roles/${b}/composites`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { child_role_id: a },
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([204, 409]);

    const edges = await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .select()
        .from(roleComposites)
        .where(
          or(
            and(eq(roleComposites.parentRoleId, a), eq(roleComposites.childRoleId, b)),
            and(eq(roleComposites.parentRoleId, b), eq(roleComposites.childRoleId, a)),
          ),
        ),
    );
    expect(edges).toHaveLength(1);
  });
});

describe('is refused for every capability but manage-tenant, on every route', () => {
  it('GET /roles, GET /roles/:id, PATCH /roles/:id, DELETE /roles/:id, POST /roles/:id/composites', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const child = await plainRole(t.id);
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

      const list = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/roles`,
        headers,
      });
      expect(list.statusCode, `GET /roles as ${capability}`).toBe(403);

      const read = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/roles/${id}`,
        headers,
      });
      expect(read.statusCode, `GET /roles/:id as ${capability}`).toBe(403);

      const amend = await fixture.http.inject({
        method: 'PATCH',
        url: `/admin/tenants/${t.name}/roles/${id}`,
        headers,
        payload: { description: 'x' },
      });
      expect(amend.statusCode, `PATCH /roles/:id as ${capability}`).toBe(403);

      const del = await fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${t.name}/roles/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(del.statusCode, `DELETE /roles/:id as ${capability}`).toBe(403);

      const composite = await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/roles/${id}/composites`,
        headers,
        payload: { child_role_id: child },
      });
      expect(composite.statusCode, `POST /roles/:id/composites as ${capability}`).toBe(403);
    }
  });
});

// Every usecase in this file takes `audit` as a dependency rather than
// calling a sink directly — the same seam #/usecase/subjects.ts uses —
// driven directly here so a mutation's exactly-once call and a refusal's
// zero calls are pinned without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: RoleAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: RoleAuditEvent) => Promise<void>;
  } {
    const events: RoleAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once when it creates a role', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      createRole(
        tx,
        { audit },
        {
          tenantId: t.id,
          name: `audited-${newId()}`,
          description: null,
          clientId: null,
          defaultForNewSubjects: false,
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('role.create');
  });

  it('calls audit exactly once on a successful amendment, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);

    const ok = collector();
    const amended = await withTenant(fixture.app.db, t.id, (tx) =>
      amendRole(
        tx,
        { audit: ok.audit },
        {
          roleId: id,
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
      amendRole(
        tx,
        { audit: refused.audit },
        {
          roleId: id,
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
    const id = await plainRole(t.id);

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteRole(
        tx,
        { audit: ok.audit },
        {
          roleId: id,
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
      deleteRole(
        tx,
        { audit: refused.audit },
        {
          roleId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once adding a composite, and not on a capability-ceiling refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const ok = collector();
    const added = await withTenant(fixture.app.db, t.id, (tx) =>
      addRoleComposite(
        tx,
        { audit: ok.audit },
        {
          parentRoleId: parentId,
          childRoleId: manageUsersId,
          // manage-users itself composites view-users (provisionAdminClient's
          // viewCounterpart wiring), so a real holder's expanded
          // capabilities carry both — the same reason
          // groups.int.test.ts's ceiling setup hands a fully expanded set.
          callerCapabilities: new Set(['manage-users', 'view-users']),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(added.kind).toBe('ok');
    expect(ok.events).toHaveLength(1);

    const otherParentId = await plainRole(t.id);
    const refused = collector();
    const outcome = await withTenant(fixture.app.db, t.id, (tx) =>
      addRoleComposite(
        tx,
        { audit: refused.audit },
        {
          parentRoleId: otherParentId,
          childRoleId: tenantAdminId,
          callerCapabilities: new Set(['manage-users']),
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
