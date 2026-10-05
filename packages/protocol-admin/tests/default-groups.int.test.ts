import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository, TENANT_ADMIN } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { storedFields } from '#/testing/stored-fields';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { composeUserSubject } from '#/usecase/subjects';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

async function call(
  tenantName: string,
  capabilities: readonly string[],
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  tail: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, [...capabilities]);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function group(tenantName: string, name: string, parentId?: string): Promise<string> {
  const res = await call(tenantName, ['manage-tenant'], 'POST', '/groups', {
    name,
    ...(parentId === undefined ? {} : { parent_id: parentId }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

function putDefault(
  tenantName: string,
  groupId: string,
  value: boolean,
  capabilities: readonly string[] = ['manage-tenant'],
): Promise<LightMyRequestResponse> {
  return call(tenantName, capabilities, 'PUT', `/groups/${groupId}/default`, { default: value });
}

async function capabilityRoleId(tenantId: string, name: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

async function plainRole(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId, name: `plain-${newId()}` });
    return role.id;
  });
}

async function mapRole(tenantId: string, groupId: string, roleId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) => groupRepository(tx).mapRole(groupId, roleId));
}

async function groupIdsOf(tenantName: string, subjectId: string): Promise<string[]> {
  const res = await call(tenantName, ['manage-users'], 'GET', `/subjects/${subjectId}/groups`);
  return res.json<{ items: { id: string }[] }>().items.map((item) => item.id);
}

async function createdSubjectGroups(tenantName: string): Promise<string[]> {
  const created = await call(tenantName, ['manage-users'], 'POST', '/subjects', {
    username: `new-${newId()}`,
  });
  expect(created.statusCode, created.body).toBe(201);
  return groupIdsOf(tenantName, created.json<{ id: string }>().id);
}

async function auditOutcomes(tenantName: string, action: string): Promise<unknown[]> {
  const res = await call(tenantName, ['view-audit'], 'GET', `/audit?action=${action}`);
  return res
    .json<{ items: { outcome: string; detail: unknown }[] }>()
    .items.map((item) => ({ outcome: item.outcome, detail: item.detail }));
}

async function systemToken(): Promise<string> {
  return fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
}

async function exportOf(tenantName: string): Promise<TenantDocument> {
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/export?include=subjects`,
    headers: { authorization: `Bearer ${await systemToken()}` },
  });
  expect(res.statusCode, res.payload).toBe(200);
  return tenantDocumentSchema.parse(JSON.parse(res.payload));
}

async function importDocument(document: unknown): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: '/admin/tenant-imports',
    headers: {
      authorization: `Bearer ${await systemToken()}`,
      'content-type': 'application/json',
    },
    payload: JSON.stringify({ name: `imp-${newId()}`, document }),
  });
}

describe('PUT /admin/tenants/{t}/groups/{id}/default', () => {
  it('sets and unsets the default, and a subject created afterwards follows it', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');

    const set = await putDefault(t.name, id, true);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<{ default_for_new_subjects: boolean }>().default_for_new_subjects).toBe(true);
    expect(set.headers.etag).toBe(etagOf(storedFields(set.json())));
    expect(await createdSubjectGroups(t.name)).toEqual([id]);

    const unset = await putDefault(t.name, id, false);
    expect(unset.json<{ default_for_new_subjects: boolean }>().default_for_new_subjects).toBe(
      false,
    );
    expect(await createdSubjectGroups(t.name)).toEqual([]);

    expect(await auditOutcomes(t.name, 'group.default_set')).toEqual(
      expect.arrayContaining([
        {
          outcome: 'allowed',
          detail: { default_for_new_subjects: { before: false, after: true } },
        },
        {
          outcome: 'allowed',
          detail: { default_for_new_subjects: { before: true, after: false } },
        },
      ]),
    );
  });

  it('answers 412 to a stale If-Match, and 404 to an unknown or foreign group', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const other = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    const foreign = await group(other.name, 'everyone');

    const stale = await call(
      t.name,
      ['manage-tenant'],
      'PUT',
      `/groups/${id}/default`,
      { default: true },
      { 'if-match': '"stale"' },
    );
    expect(stale.statusCode).toBe(412);
    expect((await putDefault(t.name, newId(), true)).statusCode).toBe(404);
    expect((await putDefault(t.name, foreign, true)).statusCode).toBe(404);
  });

  it.each([
    ['its own roles', false],
    ['an ancestor’s roles', true],
  ])(
    'refuses a group whose %s reach an admin capability, even for a tenant-admin holder',
    async (_label, viaParent) => {
      const t = await fixture.createTenant(`dg-${newId()}`);
      const parent = await group(t.name, 'staff');
      const child = await group(t.name, 'everyone', parent);
      const holder = viaParent ? parent : child;
      await mapRole(t.id, holder, await capabilityRoleId(t.id, 'view-users'));

      const res = await putDefault(t.name, child, true, [TENANT_ADMIN]);
      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toContain('view-users');
      expect(await auditOutcomes(t.name, 'group.default_set')).toEqual([
        { outcome: 'refused', detail: { denied: ['view-users'] } },
      ]);
      expect(await createdSubjectGroups(t.name)).toEqual([]);
    },
  );

  it('always lets a default be unset', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    await withTenant(fixture.app.db, t.id, (tx) =>
      groupRepository(tx).setDefaultForNewSubjects(id, true),
    );
    await mapRole(t.id, id, await capabilityRoleId(t.id, 'view-users'));
    expect((await putDefault(t.name, id, false)).statusCode).toBe(200);
  });

  it('is refused by PATCH, which names this operation', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    const res = await call(t.name, ['manage-tenant'], 'PATCH', `/groups/${id}`, {
      default_for_new_subjects: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('/default');
  });
});

describe('what a default group may never reach', () => {
  it('refuses mapping a capability role to a default group, or to its ancestor', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const parent = await group(t.name, 'staff');
    const child = await group(t.name, 'everyone', parent);
    expect((await putDefault(t.name, child, true)).statusCode).toBe(200);
    const capability = await capabilityRoleId(t.id, 'view-users');

    for (const target of [child, parent]) {
      const read = await call(t.name, [TENANT_ADMIN], 'GET', `/groups/${target}/roles`);
      const res = await call(
        t.name,
        [TENANT_ADMIN],
        'PUT',
        `/groups/${target}/roles`,
        { role_ids: [capability] },
        { 'if-match': String(read.headers.etag) },
      );
      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toContain('every new subject');
    }
    const plain = await plainRole(t.id);
    const read = await call(t.name, [TENANT_ADMIN], 'GET', `/groups/${parent}/roles`);
    const allowed = await call(
      t.name,
      [TENANT_ADMIN],
      'PUT',
      `/groups/${parent}/roles`,
      { role_ids: [plain] },
      { 'if-match': String(read.headers.etag) },
    );
    expect(allowed.statusCode).toBe(200);
  });

  it('refuses nesting a capability under a role a default group maps', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    const mapped = await plainRole(t.id);
    await mapRole(t.id, id, mapped);
    expect((await putDefault(t.name, id, true)).statusCode).toBe(200);

    const res = await call(t.name, [TENANT_ADMIN], 'POST', `/roles/${mapped}/composites`, {
      child_role_id: await capabilityRoleId(t.id, 'view-users'),
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses reparenting a default group, or its ancestor, under a capability chain', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const admins = await group(t.name, 'admins');
    await mapRole(t.id, admins, await capabilityRoleId(t.id, 'view-users'));
    const parent = await group(t.name, 'staff');
    const child = await group(t.name, 'everyone', parent);
    expect((await putDefault(t.name, child, true)).statusCode).toBe(200);

    for (const target of [child, parent]) {
      const res = await call(t.name, [TENANT_ADMIN], 'PATCH', `/groups/${target}`, {
        parent_id: admins,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ detail: string }>().detail).toContain('every new subject');
    }
  });
});

describe('every door a subject is created through', () => {
  it('joins the default groups on self-registration’s composition', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    expect((await putDefault(t.name, id, true)).statusCode).toBe(200);
    const { subjectId } = await withTenant(fixture.app.db, t.id, (tx) =>
      composeUserSubject(tx, { tenantId: t.id, username: `self-${newId()}`, email: null }),
    );
    expect(await groupIdsOf(t.name, subjectId)).toEqual([id]);
  });

  // A subject in a document is one being moved, not one created: it arrives
  // with exactly the memberships it held, a default group's included, so a
  // membership an administrator removed is not handed back by the import.
  it('carries the flag through a tenant document, and a subject’s memberships as they were', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const id = await group(t.name, 'everyone');
    await group(t.name, 'other');
    expect((await putDefault(t.name, id, true)).statusCode).toBe(200);
    expect(await createdSubjectGroups(t.name)).toEqual([id]);

    const document = await exportOf(t.name);
    expect(document.groups).toContainEqual(
      expect.objectContaining({ path: '/everyone', default_for_new_subjects: true }),
    );
    expect(document.groups).toContainEqual(
      expect.objectContaining({ path: '/other', default_for_new_subjects: false }),
    );
    const template = document.subjects?.[0];
    if (template === undefined) throw new Error('fixture: the source exported no subject');
    expect(template.groups).toEqual(['/everyone']);

    const imported = await importDocument({
      ...document,
      subjects: [template, { ...template, username: 'removed', groups: [] }],
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const again = await exportOf(imported.json<{ tenant: { name: string } }>().tenant.name);
    expect(again.groups).toContainEqual(
      expect.objectContaining({ path: '/everyone', default_for_new_subjects: true }),
    );
    const groupsOf = (username: string) =>
      again.subjects?.find((subject) => subject.username === username)?.groups;
    expect(groupsOf(template.username)).toEqual(['/everyone']);
    expect(groupsOf('removed')).toEqual([]);
  });

  it('refuses an import whose default group reaches an admin capability', async () => {
    const t = await fixture.createTenant(`dg-${newId()}`);
    const parent = await group(t.name, 'staff');
    await group(t.name, 'everyone', parent);
    const document = await exportOf(t.name);
    const index = document.groups.findIndex((entry) => entry.path === '/staff/everyone');
    const tampered = {
      ...document,
      groups: document.groups.map((entry, at) =>
        at === index
          ? { ...entry, default_for_new_subjects: true }
          : entry.path === '/staff'
            ? { ...entry, roles: [{ name: 'view-users', client: ADMIN_CLIENT_ID }] }
            : entry,
      ),
    };
    const res = await importDocument(tampered);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors.map((error) => error.path)).toContain(
      `document.groups[${String(index)}].default_for_new_subjects`,
    );
  });
});
