import { requiredActionRepository } from '@odudu/authn-flows';
import { generateTotpSecret, totpCode, totpCounter } from '@odudu/crypto';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  amendSubject,
  createSubject,
  deleteCredential,
  deleteSubject,
  setRequiredActions,
  setRoles,
  type SubjectAuditEvent,
} from '#/usecase/subjects';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('POST /admin/tenants/{t}/subjects', () => {
  it('creates a user subject that then appears in the listing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const username = `ada-${newId()}`;
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username, email: `${username}@example.com` },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ id: string; username: string | null; type: string }>();
    expect(created.username).toBe(username);
    expect(created.type).toBe('user');

    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    const listed = list.json<{ items: { username: string | null }[] }>().items;
    expect(listed.map((s) => s.username)).toContain(username);
  });

  // The other half of "no password field": a created subject owes
  // update-password rather than simply having none, which is what makes
  // the refusal below safe rather than merely strict — without this, an
  // operator-created account would authenticate with no factor at all.
  it('writes an update-password required action for the created subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `owed-${newId()}` },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();

    const pending = await withTenant(fixture.app.db, t.id, (tx) =>
      requiredActionRepository(tx).pendingFor(id),
    );
    expect(pending).toEqual(['update-password']);
  });

  // No password field exists on this door: creating a subject writes an
  // update-password required action instead, so no operator ever handles a
  // user's password. Zod's default `additionalProperties: false` is what
  // refuses it; this pins the rule rather than the mechanism.
  it('refuses a password field on the request', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}`, password: 'hunter2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a duplicate username with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const payload = { username: `dup-${newId()}` };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/subjects`;

    const first = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({ method: 'POST', url, headers, payload });
    expect(second.statusCode).toBe(409);
  });

  it('refuses a malformed email with 400', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { username: `x-${newId()}`, email: 'not-an-address' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a duplicate email with 409', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const url = `/admin/tenants/${t.name}/subjects`;
    const email = `dup-${newId()}@example.com`;

    const first = await fixture.http.inject({
      method: 'POST',
      url,
      headers,
      payload: { username: `a-${newId()}`, email },
    });
    expect(first.statusCode).toBe(201);

    const second = await fixture.http.inject({
      method: 'POST',
      url,
      headers,
      payload: { username: `b-${newId()}`, email },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /admin/tenants/{t}/subjects', () => {
  // manage-users composes view-users (provisionAdminClient's own
  // viewCounterpart wiring), through role_composites — not a special case
  // in authorizeAdmin, so a caller holding only manage-users passes a read
  // route exactly like one holding view-users.
  it('is read by view-users, and by manage-users alone', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `bob-${newId()}`);
    for (const capability of ['view-users', 'manage-users']) {
      const token = await fixture.adminToken(t.name, [capability]);
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${t.name}/subjects`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('refuses a caller holding neither capability', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, []);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('filters by a username prefix with ?search=', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const prefix = `ss-${newId()}`;
    await fixture.createSubject(t.name, `${prefix}-match`);
    await fixture.createSubject(t.name, `other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?search=${prefix}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { username: string | null }[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.username?.startsWith(prefix) === true)).toBe(true);
  });

  it('carries ?search= into the next page link, so following it stays filtered', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const prefix = `carry-${newId()}`;
    await fixture.createSubject(t.name, `${prefix}-a`);
    await fixture.createSubject(t.name, `${prefix}-b`);
    await fixture.createSubject(t.name, `other-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?search=${prefix}&limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const link = first.headers.link;
    if (typeof link !== 'string') throw new Error('expected a Link header on a filtered page');
    const nextPath = /<([^>]+)>/.exec(link)?.[1];
    if (nextPath === undefined) throw new Error('expected a URL inside the Link header');
    expect(nextPath).toContain(`search=${prefix}`);

    const second = await fixture.http.inject({
      method: 'GET',
      url: nextPath,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    const items = second.json<{ items: { username: string | null }[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.username?.startsWith(prefix) === true)).toBe(true);
  });

  it('pages by cursor', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createSubject(t.name, `page-a-${newId()}`);
    await fixture.createSubject(t.name, `page-b-${newId()}`);
    await fixture.createSubject(t.name, `page-c-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const first = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ items: unknown[]; next?: string }>();
    expect(body.items.length).toBe(1);
    expect(body.next).toBeDefined();
    expect(first.headers.link).toContain('rel="next"');
  });

  it('lists a service subject, distinguishable by type', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await fixture.createConfidentialClient(t.name, {});
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects?limit=200`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { type: string }[] }>().items;
    expect(items.some((s) => s.type === 'service')).toBe(true);
  });
});

describe('GET /admin/tenants/{t}/subjects/{id}', () => {
  it('returns the subject with an ETag pinned to the body', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `read-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(etagOf(res.json()));
  });

  it('404s an id no subject holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// The role id a tenant's own admin client carries for a capability name —
// what a PUT .../roles body names, and what the ceiling tests below assign
// to smuggle (or legitimately hold) an escalation.
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
// `tenant-admin` — the capability ceiling has to catch this through
// role_composites, not through a name comparison on the request body.
async function roleNestingTenantAdmin(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const nested = await roleRepository(tx).create({ tenantId, name: `nests-admin-${newId()}` });
    const tenantAdminId = await capabilityRoleId(tenantId, TENANT_ADMIN);
    await roleRepository(tx).addComposite(nested.id, tenantAdminId);
    return nested.id;
  });
}

function putRoles(
  tenantName: string,
  subjectId: string,
  token: string,
  roleIds: string[],
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenantName}/subjects/${subjectId}/roles`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { role_ids: roleIds },
  });
}

describe('PUT /admin/tenants/{t}/subjects/{id}/roles — the capability ceiling', () => {
  it('refuses a manage-users-only caller assigning tenant-admin', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const res = await putRoles(t.name, targetId, token, [tenantAdminId]);
    expect(res.statusCode).toBe(403);
  });

  it('refuses the same escalation in the system tenant, for manage-tenants', async () => {
    const { id: targetId } = await fixture.createSubject(SYSTEM_TENANT_NAME, `target-${newId()}`);
    const token = await fixture.systemAdminToken(['manage-users']);
    const manageTenantsId = await capabilityRoleId(fixture.systemTenantId, MANAGE_TENANTS);

    const res = await putRoles(SYSTEM_TENANT_NAME, targetId, token, [manageTenantsId]);
    expect(res.statusCode).toBe(403);
  });

  it('lets a tenant-admin holder assign manage-users freely', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');

    const res = await putRoles(t.name, targetId, token, [manageUsersId]);
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { name: string }[] }>().items;
    expect(items.map((r) => r.name)).toContain('manage-users');
  });

  it('refuses a composite that nests tenant-admin rather than naming it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const nestedRoleId = await roleNestingTenantAdmin(t.id);

    const res = await putRoles(t.name, targetId, token, [nestedRoleId]);
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /admin/tenants/{t}/subjects/{id}/roles', () => {
  it('replaces a subject role assignment, and a removed role stops appearing', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, [TENANT_ADMIN]);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');
    const manageUsersId = await capabilityRoleId(t.id, 'manage-users');

    const first = await putRoles(t.name, targetId, token, [viewUsersId]);
    expect(first.statusCode).toBe(200);

    const second = await putRoles(t.name, targetId, token, [manageUsersId]);
    expect(second.statusCode).toBe(200);
    const items = second.json<{ items: { id: string; name: string }[] }>().items;
    expect(items.map((r) => r.id)).toEqual([manageUsersId]);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: targetId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');

    const res = await putRoles(t.name, targetId, token, [viewUsersId]);
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /admin/tenants/{t}/subjects/{id}', () => {
  it('amends email and enabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { email: 'ada@example.com', enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ email: string | null; enabled: boolean }>();
    expect(body.email).toBe('ada@example.com');
    expect(body.enabled).toBe(false);
  });

  // Regression for a partial write: `enabled` used to be written before
  // `email` was validated, so a refusal on `email` still committed the
  // disable. A service subject has no `users` row, which is what makes
  // `email` refuse here — the write of `enabled` must not survive that.
  it('refuses email on a service subject with 400, and leaves it enabled', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byId(client.id);
      if (row?.serviceSubjectId === null || row?.serviceSubjectId === undefined) {
        throw new Error('fixture: confidential client has no service subject');
      }
      return row.serviceSubjectId;
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false, email: 'ops@example.com' },
    });
    expect(res.statusCode).toBe(400);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<{ enabled: boolean }>().enabled).toBe(true);
  });

  it('refuses a malformed email with 400 and writes nothing, enabled included', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false, email: 'x' },
    });
    expect(res.statusCode).toBe(400);

    const after = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = after.json<{ enabled: boolean; email: string | null }>();
    expect(body.enabled).toBe(true);
    expect(body.email).toBeNull();
  });

  it('repeating a disable is a no-op for the timestamp', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const first = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers,
      payload: { enabled: false },
    });
    expect(first.statusCode).toBe(200);
    const disabledAt = await withTenant(fixture.app.db, t.id, (tx) =>
      subjectRepository(tx).byId(id),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers,
      payload: { enabled: false },
    });
    expect(second.statusCode).toBe(200);
    const stillDisabledAt = await withTenant(fixture.app.db, t.id, (tx) =>
      subjectRepository(tx).byId(id),
    );

    expect(stillDisabledAt?.disabledAt?.getTime()).toBe(disabledAt?.disabledAt?.getTime());
  });

  it('answers 412 when If-Match no longer matches', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"stale"',
      },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(412);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `pat-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/tenants/{t}/subjects/{id}', () => {
  it('removes the subject and detaches a client that named it as its service account', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const serviceSubjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const row = await clientRepository(tx).byId(client.id);
      if (row?.serviceSubjectId === null || row?.serviceSubjectId === undefined) {
        throw new Error('fixture: confidential client has no service subject');
      }
      return row.serviceSubjectId;
    });
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${serviceSubjectId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);

    const survived = await withTenant(fixture.app.db, t.id, (tx) =>
      clientRepository(tx).byId(client.id),
    );
    expect(survived?.serviceSubjectId).toBeNull();
    expect(survived?.tenantId).toBe(t.id);
  });

  it('404s an id no subject holds', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${newId()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `del-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /admin/tenants/{t}/subjects/{id}/required-actions', () => {
  it('sets the list', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `req-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { actions: ['configure-totp', 'generate-recovery-codes'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ actions: string[] }>().actions.sort()).toEqual(
      ['configure-totp', 'generate-recovery-codes'].sort(),
    );

    // A second PUT that omits one clears it — a replacement, not a merge.
    const replaced = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { actions: ['configure-totp'] },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json<{ actions: string[] }>().actions).toEqual(['configure-totp']);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `req-${newId()}`);
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/subjects/${id}/required-actions`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { actions: ['configure-totp'] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/tenants/{t}/subjects/{id}/credentials', () => {
  it('carries type, created_at and a recovery-code count, never a secret', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'password',
        secret: { kind: 'password', hash: await hashPassword('correct horse battery staple') },
      });
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'recovery-code',
        secret: { kind: 'recovery-code', hash: await hashPassword('one-of-ten') },
      });
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    // The serialised body, not a mapped object — a leak through a field
    // the wire mapping forgot to omit would not show up any other way.
    expect(res.body).not.toContain('secret_data');
    expect(res.body).not.toContain('hash');

    const items = res.json<{
      items: {
        id?: string;
        type: string;
        created_at: string;
        expired?: boolean;
        recovery_code_count?: number;
      }[];
    }>().items;
    const password = items.find((c) => c.type === 'password');
    expect(password?.expired).toBe(false);
    const recovery = items.find((c) => c.type === 'recovery-code');
    expect(recovery?.recovery_code_count).toBe(1);
    expect(recovery?.id).toBeUndefined();
  });

  it('refuses a caller holding neither view-users nor manage-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const token = await fixture.adminToken(t.name, []);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /admin/tenants/{t}/subjects/{id}/credentials/{credentialId}', () => {
  const REDIRECT_URI = 'https://app.example/callback';
  // RFC 7636 Appendix B's worked example.
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const PASSWORD = 'correct horse battery staple';

  function authorizeUrl(tenantName: string, clientId: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: 'openid',
      state: 'xyz',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
    });
    return `/tenants/${tenantName}/protocol/openid-connect/auth?${params.toString()}`;
  }

  async function startAuthSession(tenantName: string, clientId: string): Promise<string> {
    const authorize = await fixture.http.inject({ url: authorizeUrl(tenantName, clientId) });
    if (authorize.statusCode !== 200) {
      throw new Error(
        `expected /authorize to render the login form, got ${String(authorize.statusCode)}`,
      );
    }
    const match = /name="auth_session_id" value="([^"]*)"/.exec(authorize.body);
    const authSessionId = match?.[1];
    if (authSessionId === undefined) throw new Error('auth_session_id not found in the login form');
    return authSessionId;
  }

  function submit(
    tenantName: string,
    fields: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    return fixture.http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/login-actions/authenticate`,
      payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  async function redeemCode(
    tenantName: string,
    clientId: string,
    clientSecret: string,
    code: string,
  ): Promise<LightMyRequestResponse> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
    });
    return fixture.http.inject({
      method: 'POST',
      url: `/tenants/${tenantName}/protocol/openid-connect/token`,
      payload: form.toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    });
  }

  it('removes a TOTP enrolment, and the subject then logs in without it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {
      grantTypes: ['authorization_code'],
      redirectUris: [REDIRECT_URI],
    });
    const username = `mfa-${newId()}`;

    const { subjectId, credentialId, totpSecret } = await withTenant(
      fixture.app.db,
      t.id,
      async (tx) => {
        const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
        await userRepository(tx).create({ subjectId: subject.id, tenantId: t.id, username });
        await credentialRepository(tx).insert({
          tenantId: t.id,
          subjectId: subject.id,
          type: 'password',
          secret: { kind: 'password', hash: await hashPassword(PASSWORD) },
        });
        const secret = generateTotpSecret();
        await credentialRepository(tx).insert({
          tenantId: t.id,
          subjectId: subject.id,
          type: 'totp',
          secret: { kind: 'totp', secret, digits: 6, lastStep: 0 },
        });
        const [row] = await credentialRepository(tx).listFor(subject.id, 'totp');
        if (row === undefined) throw new Error('fixture: no totp credential row after insert');
        return { subjectId: subject.id, credentialId: row.id, totpSecret: secret };
      },
    );

    // Prove the second factor is actually required before removing it —
    // otherwise this test could pass with delete doing nothing.
    const firstSession = await startAuthSession(t.name, client.clientId);
    const challenged = await submit(t.name, {
      auth_session_id: firstSession,
      username,
      password: PASSWORD,
    });
    expect(challenged.statusCode).toBe(200);
    expect(challenged.body).toContain('name="code"');
    const completed = await submit(t.name, {
      auth_session_id: firstSession,
      code: totpCode(totpSecret, totpCounter(new Date())),
    });
    expect(completed.statusCode).toBe(302);

    const adminToken = await fixture.adminToken(t.name, ['manage-users']);
    const deleteRes = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${subjectId}/credentials/${credentialId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // A fresh login: password alone now completes it, without the OTP
    // step the first login above proved was required.
    const secondSession = await startAuthSession(t.name, client.clientId);
    const afterDelete = await submit(t.name, {
      auth_session_id: secondSession,
      username,
      password: PASSWORD,
    });
    expect(afterDelete.statusCode).toBe(302);
    const location = afterDelete.headers.location;
    if (typeof location !== 'string') throw new Error('expected a location header');
    const code = new URL(location).searchParams.get('code');
    expect(code).not.toBeNull();
    if (code === null) throw new Error('expected a code on the post-delete login redirect');

    const redeemed = await redeemCode(t.name, client.clientId, client.secret, code);
    expect(redeemed.statusCode).toBe(200);
  });

  it('refuses a caller holding only view-users', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const credentialId = await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'totp',
        secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
      });
      const [row] = await credentialRepository(tx).listFor(id, 'totp');
      if (row === undefined) throw new Error('fixture: no totp credential after insert');
      return row.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${t.name}/subjects/${id}/credentials/${credentialId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// Every usecase in this file takes `audit` as a dependency rather than
// calling a sink directly (the same seam #/usecase/clients.ts and
// #/usecase/tenants.ts use) — these drive the usecases directly, the way
// clients.int.test.ts's own `describe('createClient', ...)` does, so a
// mutation's exactly-once call and a refusal's zero calls are pinned
// without going through HTTP.
describe('audit', () => {
  function collector(): {
    events: SubjectAuditEvent[];
    audit: (tx: TenantScopedDatabase, e: SubjectAuditEvent) => Promise<void>;
  } {
    const events: SubjectAuditEvent[] = [];
    return {
      events,
      audit: (_tx, event) => {
        events.push(event);
        return Promise.resolve();
      },
    };
  }

  it('calls audit exactly once when it creates a subject', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { events, audit } = collector();
    await withTenant(fixture.app.db, t.id, (tx) =>
      createSubject(
        tx,
        { audit },
        {
          tenantId: t.id,
          username: `audited-${newId()}`,
          email: null,
          actorSubjectId: 'test-subject',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('subject.create');
  });

  it('calls audit exactly once on a successful amendment, and not on a refusal', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `amend-${newId()}`);

    const ok = collector();
    const amended = await withTenant(fixture.app.db, t.id, (tx) =>
      amendSubject(
        tx,
        { audit: ok.audit },
        {
          subjectId: id,
          values: { enabled: false },
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
      amendSubject(
        tx,
        { audit: refused.audit },
        {
          subjectId: id,
          values: { not_a_field: true },
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
    const { id } = await fixture.createSubject(t.name, `del-${newId()}`);

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteSubject(
        tx,
        { audit: ok.audit },
        {
          subjectId: id,
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
      deleteSubject(
        tx,
        { audit: refused.audit },
        {
          subjectId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once removing a credential, and not when refused', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `cred-${newId()}`);
    const credentialId = await withTenant(fixture.app.db, t.id, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: t.id,
        subjectId: id,
        type: 'totp',
        secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
      });
      const [row] = await credentialRepository(tx).listFor(id, 'totp');
      if (row === undefined) throw new Error('fixture: no totp credential after insert');
      return row.id;
    });

    const ok = collector();
    const deleted = await withTenant(fixture.app.db, t.id, (tx) =>
      deleteCredential(
        tx,
        { audit: ok.audit },
        {
          subjectId: id,
          credentialId,
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
      deleteCredential(
        tx,
        { audit: refused.audit },
        {
          subjectId: id,
          credentialId: newId(),
          actorSubjectId: 'test',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );
    expect(outcome.kind).toBe('not_found');
    expect(refused.events).toHaveLength(0);
  });

  it('calls audit exactly once setting required actions, and not on not_found', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id } = await fixture.createSubject(t.name, `ra-${newId()}`);

    const ok = collector();
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setRequiredActions(
        tx,
        { audit: ok.audit },
        {
          tenantId: t.id,
          subjectId: id,
          actions: ['configure-totp'],
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
      setRequiredActions(
        tx,
        { audit: refused.audit },
        {
          tenantId: t.id,
          subjectId: newId(),
          actions: [],
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
    const { id } = await fixture.createSubject(t.name, `roles-${newId()}`);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');
    const tenantAdminId = await capabilityRoleId(t.id, TENANT_ADMIN);

    const ok = collector();
    const set = await withTenant(fixture.app.db, t.id, (tx) =>
      setRoles(
        tx,
        { audit: ok.audit },
        {
          subjectId: id,
          roleIds: [viewUsersId],
          callerCapabilities: new Set(['manage-users', 'view-users']),
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
      setRoles(
        tx,
        { audit: refused.audit },
        {
          subjectId: id,
          roleIds: [tenantAdminId],
          callerCapabilities: new Set(['manage-users']),
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
