import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { roleComposites, roleRepository, subjectRoles } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { and, eq, or, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capabilitiesReachableFrom } from '#/service/capability-ceiling';
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

  it('400s a child_role_id that is not an id at all, not 500', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${parentId}/composites`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { child_role_id: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
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

async function seedRole(
  tenantName: string,
  name: string,
  clientId?: string,
): Promise<{ id: string; name: string }> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/roles`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { name, ...(clientId === undefined ? {} : { client_id: clientId }) },
  });
  if (res.statusCode !== 201) throw new Error(`could not create role ${name}: ${res.body}`);
  return res.json<{ id: string; name: string }>();
}

async function seedClient(tenantName: string, clientId: string): Promise<string> {
  const token = await fixture.adminToken(tenantName, ['manage-clients']);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenantName}/clients`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      client_id: clientId,
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    },
  });
  if (res.statusCode !== 201) throw new Error(`could not create ${clientId}: ${res.body}`);
  return res.json<{ id: string }>().id;
}

async function listRolesAt(tenantName: string, query: string): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/roles?${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function roleNamesOf(res: LightMyRequestResponse): string[] {
  return res.json<{ items: { name: string }[] }>().items.map((r) => r.name);
}

// PostgreSQL's own answer, in the order a searched listing promises, so no
// expectation here folds a string in JavaScript.
async function roleNameMatches(tenantId: string, prefix: string): Promise<string[]> {
  const rows = await fixture.owner.db.execute<{ name: string }>(sql`
    select name from roles
     where tenant_id = ${tenantId} and starts_with(lower(name), lower(${prefix}))
     order by lower(name) collate "C", id
  `);
  return rows.map((row) => row.name);
}

describe('GET /admin/tenants/{t}/roles — search and filters', () => {
  it('finds a name case-insensitively, ordered by the folded name, then by id', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['Billing-c', 'BILLING-A', 'billing-b', 'Billing-a2', 'other']) {
      await seedRole(t.name, name);
    }

    const res = await listRolesAt(t.name, 'name=billing');
    expect(res.statusCode).toBe(200);
    const expected = await roleNameMatches(t.id, 'billing');
    expect(expected).toHaveLength(4);
    expect(roleNamesOf(res)).toEqual(expected);
  });

  it('pages a name search one row at a time, each match once and in order', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['ops-b', 'OPS-a', 'ops-c', 'other']) await seedRole(t.name, name);

    const seen: string[] = [];
    let query = 'name=ops&limit=1';
    for (let page = 0; page < 5; page += 1) {
      const res = await listRolesAt(t.name, query);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { name: string }[]; next?: string }>();
      seen.push(...body.items.map((r) => r.name));
      if (body.next === undefined) break;
      query = `name=ops&limit=1&cursor=${encodeURIComponent(body.next)}`;
    }
    expect(seen).toEqual(['OPS-a', 'ops-b', 'ops-c']);
  });

  it('reads _ and % as ordinary characters', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['axb', 'a_b', 'a%b']) await seedRole(t.name, name);

    expect(roleNamesOf(await listRolesAt(t.name, 'name=a_b'))).toEqual(['a_b']);
    expect(roleNamesOf(await listRolesAt(t.name, 'name=a%25'))).toEqual(['a%b']);
  });

  it('?client=tenant answers only tenant roles, ?client=<id> only that client’s', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const shop = await seedClient(t.name, 'shop');
    const blog = await seedClient(t.name, 'blog');
    await seedRole(t.name, 'r-tenant');
    await seedRole(t.name, 'r-shop', shop);
    await seedRole(t.name, 'r-blog', blog);

    const tenantOnly = await listRolesAt(t.name, 'client=tenant&limit=200');
    expect(tenantOnly.statusCode).toBe(200);
    const tenantItems = tenantOnly.json<{ items: { name: string; client_id: string | null }[] }>()
      .items;
    expect(tenantItems.map((r) => r.name)).toContain('r-tenant');
    expect(tenantItems.every((r) => r.client_id === null)).toBe(true);

    const shopOnly = await listRolesAt(t.name, `client=${shop}`);
    expect(roleNamesOf(shopOnly)).toEqual(['r-shop']);
    expect(roleNamesOf(await listRolesAt(t.name, `client=${blog}&name=R-`))).toEqual(['r-blog']);
    expect(roleNamesOf(await listRolesAt(t.name, 'client=tenant&name=r-'))).toEqual(['r-tenant']);
  });

  it('refuses a client that is neither tenant nor an id, naming the parameter', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await listRolesAt(t.name, 'client=shop');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('querystring/client');
  });

  it('finds nothing under ?client= naming a client of another tenant, searched or not', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    const foreignClient = await seedClient(other.name, 'foreign-shop');
    await seedRole(other.name, 'foreign-role', foreignClient);

    for (const query of [`client=${foreignClient}`, `client=${foreignClient}&name=foreign`]) {
      const res = await listRolesAt(t.name, query);
      expect(res.statusCode, query).toBe(200);
      expect(roleNamesOf(res), query).toEqual([]);
    }
    expect(roleNamesOf(await listRolesAt(other.name, `client=${foreignClient}`))).toEqual([
      'foreign-role',
    ]);
  });

  it('finds nothing searching for a role that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    await seedRole(other.name, 'foreign-role');

    const res = await listRolesAt(t.name, 'name=foreign');
    expect(res.statusCode).toBe(200);
    expect(roleNamesOf(res)).toEqual([]);
  });

  it('refuses an unknown parameter with 400 naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const res = await listRolesAt(t.name, 'search=r');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('search');
  });

  it.each([
    ['another search', 'name=a&limit=1', 'name=b&limit=1'],
    ['a filter added', 'name=a&limit=1', 'name=a&client=tenant&limit=1'],
    ['a filter dropped', 'name=a&client=tenant&limit=1', 'name=a&limit=1'],
  ])('refuses a cursor replayed under %s', async (_label, minted, replayedUnder) => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    for (const name of ['a-1', 'a-2', 'b-1', 'b-2']) await seedRole(t.name, name);

    const first = await listRolesAt(t.name, minted);
    const next = first.json<{ next?: string }>().next;
    if (next === undefined) throw new Error('expected a next cursor');

    const replayed = await listRolesAt(
      t.name,
      `${replayedUnder}&cursor=${encodeURIComponent(next)}`,
    );
    expect(replayed.statusCode).toBe(400);
    expect(replayed.json<{ detail: string }>().detail).toBe('cursor is invalid or expired');
  });
});

describe('the roles name_search column', () => {
  it('is refused on create, filled by the database, and never answered', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const create = (payload: Record<string, unknown>) =>
      fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/roles`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload,
      });
    const forged = await create({ name: 'Mixed-Case', name_search: 'forged' });
    expect(forged.statusCode).toBe(400);
    expect(forged.json<{ detail: string }>().detail).toContain('name_search');

    const res = await create({ name: 'Mixed-Case' });
    expect(res.statusCode).toBe(201);
    const created = res.json<Record<string, unknown>>();
    expect(created).not.toHaveProperty('name_search');

    const rows = await fixture.owner.db.execute<{ name_search: string }>(
      sql`select name_search from roles where id = ${String(created.id)}`,
    );
    expect(rows.map((row) => row.name_search)).toEqual(['mixed-case']);

    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles/${String(created.id)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.json<Record<string, unknown>>()).not.toHaveProperty('name_search');
  });

  it('is refused by PATCH with a reason', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name_search: 'forged' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain('name_search');
  });
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function nest(tenantId: string, parentId: string, childId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) =>
    roleRepository(tx).addComposite(parentId, childId),
  );
}

async function auditRows(
  tenantName: string,
  action: string,
): Promise<{ outcome: string; resource_id: string; detail: Record<string, unknown> }[]> {
  const token = await fixture.adminToken(tenantName, ['view-audit']);
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/audit`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res
    .json<{
      items: {
        action: string;
        outcome: string;
        resource_id: string;
        detail: Record<string, unknown>;
      }[];
    }>()
    .items.filter((item) => item.action === action);
}

async function getComposites(
  tenantName: string,
  roleId: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/roles/${roleId}/composites`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function removeComposite(
  tenantName: string,
  roleId: string,
  childId: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'DELETE',
    url: `/admin/tenants/${tenantName}/roles/${roleId}/composites/${childId}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function putDefault(
  tenantName: string,
  roleId: string,
  token: string,
  value: boolean,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/roles/${roleId}/default`,
    headers: auth(token),
    payload: { default: value },
  });
}

describe('GET /admin/tenants/{t}/roles/{id}/composites', () => {
  it('lists the direct children only, in the role wire shape', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const childId = await plainRole(t.id);
    const grandchildId = await plainRole(t.id);
    await nest(t.id, parentId, childId);
    await nest(t.id, childId, grandchildId);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await getComposites(t.name, parentId, token);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.map((item) => item.id)).toEqual([childId]);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      'client_id',
      'created_at',
      'default_for_new_subjects',
      'description',
      'id',
      'name',
    ]);
  });

  it('answers an empty list for a role with none, and 404 for no role', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const empty = await getComposites(t.name, id, token);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ items: [] });
    expect((await getComposites(t.name, newId(), token)).statusCode).toBe(404);
  });

  it('404s a role that belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    const foreignParent = await plainRole(other.id);
    await nest(other.id, foreignParent, await plainRole(other.id));
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await getComposites(t.name, foreignParent, token)).statusCode).toBe(404);
  });
});

describe('DELETE /admin/tenants/{t}/roles/{id}/composites/{childId}', () => {
  it('answers 204, then 404 on repeat, and audits the removal once', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const childId = await plainRole(t.id);
    const keptId = await plainRole(t.id);
    await nest(t.id, parentId, childId);
    await nest(t.id, parentId, keptId);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await removeComposite(t.name, parentId, childId, token)).statusCode).toBe(204);
    expect((await removeComposite(t.name, parentId, childId, token)).statusCode).toBe(404);
    const remaining = await getComposites(t.name, parentId, token);
    expect(remaining.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toEqual([keptId]);

    const rows = await auditRows(t.name, 'role.composite_remove');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'allowed',
      resource_id: parentId,
      detail: { child_role_id: childId },
    });
  });

  it('404s a parent that does not exist', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await removeComposite(t.name, newId(), await plainRole(t.id), token);
    expect(res.statusCode).toBe(404);
  });

  it('cannot remove another tenant’s edge, which stays in place', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(other.id);
    const childId = await plainRole(other.id);
    await nest(other.id, parentId, childId);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await removeComposite(t.name, parentId, childId, token)).statusCode).toBe(404);
    const edges = await fixture.owner.db
      .select()
      .from(roleComposites)
      .where(eq(roleComposites.parentRoleId, parentId));
    expect(edges).toHaveLength(1);
  });

  it('takes the child’s claim off the next token of a subject granted the parent', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['client_credentials'],
    });
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/clients/${client.id}`,
      headers: {
        ...auth(await fixture.adminToken(t.name, ['manage-clients'])),
        'if-match': '*',
      },
      payload: { client_credentials_scopes: ['roles'], full_scope_allowed: true },
    });
    expect(patched.statusCode).toBe(200);
    const parent = await seedRole(t.name, `parent-${newId()}`);
    const child = await seedRole(t.name, `child-${newId()}`);
    await nest(t.id, parent.id, child.id);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const record = await clientRepository(tx).byClientId(client.clientId);
      if (record?.serviceSubjectId == null) throw new Error('fixture: no service subject');
      await roleRepository(tx).assignToSubject(record.serviceSubjectId, parent.id);
    });

    const rolesClaim = async (): Promise<unknown> => {
      const res = await fixture.tokenRequest(t.name, client, {
        grant_type: 'client_credentials',
        scope: 'roles',
      });
      expect(res.statusCode).toBe(200);
      const accessToken = res.json<{ access_token: string }>().access_token;
      const payload: unknown = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
      return (payload as Record<string, unknown>).roles;
    };

    expect(await rolesClaim()).toEqual(expect.arrayContaining([parent.name, child.name]));
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    expect((await removeComposite(t.name, parent.id, child.id, token)).statusCode).toBe(204);
    const after = await rolesClaim();
    expect(after).toContain(parent.name);
    expect(after).not.toContain(child.name);
  });

  it.each([
    [TENANT_ADMIN, 'manage-users'],
    ['manage-users', 'view-users'],
  ])(
    'refuses taking %s’s %s away, even from a tenant-admin holder, and keeps the edge',
    async (parentName, childName) => {
      const t = await fixture.createTenant(`acme-${newId()}`);
      const parentId = await capabilityRoleId(t.id, parentName);
      const childId = await capabilityRoleId(t.id, childName);
      const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);

      const res = await removeComposite(t.name, parentId, childId, token);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ detail: string }>().detail).toContain(parentName);
      const children = await getComposites(t.name, parentId, token);
      expect(children.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toContain(
        childId,
      );
    },
  );

  it('lets an ordinary role give up a capability it nests', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const parentId = await plainRole(t.id);
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');
    await nest(t.id, parentId, manageUsersId);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await removeComposite(t.name, parentId, manageUsersId, token)).statusCode).toBe(204);
  });
});

describe('PUT /admin/tenants/{t}/roles/{id}/default', () => {
  async function newSubjectRoleIds(tenantName: string): Promise<string[]> {
    const token = await fixture.adminToken(tenantName, ['manage-users']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${tenantName}/subjects`,
      headers: auth(token),
      payload: { username: `new-${newId()}` },
    });
    expect(created.statusCode).toBe(201);
    const roles = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${tenantName}/subjects/${created.json<{ id: string }>().id}/roles`,
      headers: { authorization: `Bearer ${token}` },
    });
    return roles.json<{ items: { id: string }[] }>().items.map((r) => r.id);
  }

  it('sets and unsets the default, and a subject created afterwards follows it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const set = await putDefault(t.name, id, token, true);
    expect(set.statusCode).toBe(200);
    expect(set.json<{ default_for_new_subjects: boolean }>().default_for_new_subjects).toBe(true);
    expect(set.json<Record<string, unknown>>()).not.toHaveProperty('name_search');
    expect(set.headers.etag).toBe(etagOf(set.json()));
    expect(await newSubjectRoleIds(t.name)).toContain(id);

    const unset = await putDefault(t.name, id, token, false);
    expect(unset.statusCode).toBe(200);
    expect(unset.json<{ default_for_new_subjects: boolean }>().default_for_new_subjects).toBe(
      false,
    );
    expect(await newSubjectRoleIds(t.name)).not.toContain(id);

    const rows = await auditRows(t.name, 'role.default_set');
    expect(rows.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        { default_for_new_subjects: { before: false, after: true } },
        { default_for_new_subjects: { before: true, after: false } },
      ]),
    );
  });

  it('404s a role that does not exist, or belongs to another tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const other = await fixture.createTenant(`acme-${newId()}`);
    const foreign = await plainRole(other.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await putDefault(t.name, newId(), token, true)).statusCode).toBe(404);
    expect((await putDefault(t.name, foreign, token, true)).statusCode).toBe(404);
  });

  it.each([
    [
      'a capability role itself',
      async (tenantId: string) => capabilityRoleId(tenantId, 'view-users'),
    ],
    ['a role nesting tenant-admin', roleNestingTenantAdmin],
  ])(
    'refuses to make %s a default, even for a tenant-admin holder, and audits the refusal',
    async (_label, roleOf) => {
      const t = await fixture.createTenant(`acme-${newId()}`);
      const id = await roleOf(t.id);
      const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);

      const res = await putDefault(t.name, id, token, true);
      expect(res.statusCode).toBe(403);
      const read = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/roles/${id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(read.json<{ default_for_new_subjects: boolean }>().default_for_new_subjects).toBe(
        false,
      );
      const rows = await auditRows(t.name, 'role.default_set');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'refused', resource_id: id });
    },
  );

  it('always lets a default be unset, capability or not', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await roleNestingTenantAdmin(t.id);
    await withTenant(fixture.app.db, t.id, (tx) =>
      roleRepository(tx).setDefaultForNewSubjects(id, true),
    );
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    expect((await putDefault(t.name, id, token, false)).statusCode).toBe(200);
  });

  it('refuses nesting a capability under a role a default role reaches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const defaultId = await plainRole(t.id);
    const middleId = await plainRole(t.id);
    await nest(t.id, defaultId, middleId);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    expect((await putDefault(t.name, defaultId, token, true)).statusCode).toBe(200);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles/${middleId}/composites`,
      headers: auth(token),
      payload: { child_role_id: await capabilityRoleId(t.id, 'view-users') },
    });
    expect(res.statusCode).toBe(403);
    const rows = await auditRows(t.name, 'role.composite_add');
    expect(rows.map((row) => row.outcome)).toEqual(['refused']);
  });

  it('refuses creating a default role on the built-in admin client', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminClient = await fixture.builtinAdminClient(t.name);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const name = `default-${newId()}`;

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers: auth(token),
      payload: {
        name,
        client_id: adminClient.id,
        default_for_new_subjects: true,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ detail: string }>().detail).toContain('built-in admin client');
    const rows = await fixture.owner.db.execute<{
      outcome: string;
      resource_id: string | null;
      detail: Record<string, unknown>;
    }>(sql`
      select outcome, resource_id, detail from audit_events
       where action = 'role.create' and actor_tenant_id = ${t.id}
    `);
    expect(rows.map((row) => ({ ...row }))).toEqual([
      {
        outcome: 'refused',
        resource_id: null,
        detail: { denied: [name], client_id: adminClient.id },
      },
    ]);
  });

  it('is still refused by PATCH, which names this operation', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await plainRole(t.id);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: auth(token),
      payload: { default_for_new_subjects: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ detail: string }>().detail).toContain(
      'PUT /admin/tenants/{tenant}/roles/{id}/default',
    );
  });
});

describe('POST /admin/tenants/{t}/roles/{id}/composites — a default reaching a capability two edges down', () => {
  async function lockWaits(): Promise<number> {
    const rows = await fixture.owner.db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_locks where not granted`,
    );
    return rows[0]?.waiting ?? 0;
  }

  // Resolves once `other` has settled or is blocked on a lock, whichever
  // comes first, so a writer that never waits is observed rather than hung on.
  async function settledOrBlocked(other: Promise<unknown>): Promise<void> {
    const state = { settled: false };
    const settle = (): void => {
      state.settled = true;
    };
    other.then(settle, settle);
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (state.settled || (await lockWaits()) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the second write neither finished nor blocked');
  }

  it('refuses one of D→A and B→view-users run together, so D never reaches view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const d = await plainRole(t.id);
    const a = await plainRole(t.id);
    const b = await plainRole(t.id);
    await nest(t.id, a, b);
    await withTenant(fixture.app.db, t.id, (tx) =>
      roleRepository(tx).setDefaultForNewSubjects(d, true),
    );
    const viewUsers = await capabilityRoleId(t.id, 'view-users');
    const actor = { actorSubjectId: 'test', actorTenantId: 'test-tenant', actorClientId: 'test' };

    let arrive = (): void => undefined;
    let release = (): void => undefined;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));

    const first = withTenant(fixture.app.db, t.id, (tx) =>
      addRoleComposite(
        tx,
        {
          audit: async () => {
            arrive();
            await released;
          },
        },
        { parentRoleId: d, childRoleId: a, callerCapabilities: new Set(), ...actor },
      ),
    );
    await arrived;

    const refused: RoleAuditEvent[] = [];
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      addRoleComposite(
        tx,
        {
          audit: (_tx, event) => {
            refused.push(event);
            return Promise.resolve();
          },
        },
        {
          parentRoleId: b,
          childRoleId: viewUsers,
          callerCapabilities: new Set(['view-users']),
          ...actor,
        },
      ),
    );
    await settledOrBlocked(second);
    release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('default_role_capability');
    expect(refused.map((event) => event.outcome)).toEqual(['refused']);

    const defaults = await withTenant(fixture.app.db, t.id, (tx) =>
      roleRepository(tx).defaultsForTenant(),
    );
    const reached = await withTenant(fixture.app.db, t.id, (tx) =>
      capabilitiesReachableFrom(
        tx,
        defaults.map((role) => role.id),
      ),
    );
    expect([...reached]).toEqual([]);
  });
});
