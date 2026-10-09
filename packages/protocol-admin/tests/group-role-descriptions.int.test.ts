import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const LONG = 'x'.repeat(1001);

async function send(
  tenantName: string,
  method: 'POST' | 'PATCH' | 'GET',
  tail: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, ['manage-tenant']);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function exportOf(tenantName: string): Promise<TenantDocument> {
  const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
  const res = await fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenantName}/export`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.payload).toBe(200);
  return tenantDocumentSchema.parse(JSON.parse(res.payload));
}

async function importDocument(document: unknown): Promise<LightMyRequestResponse> {
  const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
  return fixture.http.inject({
    method: 'POST',
    url: '/admin/tenant-imports',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify({ name: `imp-${newId()}`, document }),
  });
}

describe('a group’s description', () => {
  it('is stored on create, read back, and carried in list items', async () => {
    const t = await fixture.createTenant(`gd-${newId()}`);
    const created = await send(t.name, 'POST', '/groups', {
      name: 'support',
      description: 'People who answer <tickets>',
    });
    expect(created.statusCode, created.body).toBe(201);
    const group = created.json<{ id: string; description: string | null }>();
    expect(group.description).toBe('People who answer <tickets>');

    const list = await send(t.name, 'GET', '/groups');
    expect(
      list.json<{ items: { id: string; description: string | null }[] }>().items,
    ).toContainEqual(
      expect.objectContaining({ id: group.id, description: 'People who answer <tickets>' }),
    );
  });

  it('reads a group created without one back as null', async () => {
    const t = await fixture.createTenant(`gd-${newId()}`);
    const created = await send(t.name, 'POST', '/groups', { name: 'plain' });
    expect(created.json<{ description: string | null }>().description).toBeNull();
  });

  it('is amended, and cleared with null', async () => {
    const t = await fixture.createTenant(`gd-${newId()}`);
    const { id } = (await send(t.name, 'POST', '/groups', { name: 'ops' })).json<{ id: string }>();
    const set = await send(t.name, 'PATCH', `/groups/${id}`, { description: 'On call' });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<{ description: string | null }>().description).toBe('On call');
    const cleared = await send(t.name, 'PATCH', `/groups/${id}`, { description: null });
    expect(cleared.json<{ description: string | null }>().description).toBeNull();
  });

  it('refuses one over 1000 characters on create and on amend, naming the field', async () => {
    const t = await fixture.createTenant(`gd-${newId()}`);
    const created = await send(t.name, 'POST', '/groups', { name: 'long', description: LONG });
    expect(created.statusCode).toBe(400);
    expect(created.body).toContain('description');

    const { id } = (await send(t.name, 'POST', '/groups', { name: 'ok' })).json<{ id: string }>();
    const amended = await send(t.name, 'PATCH', `/groups/${id}`, { description: LONG });
    expect(amended.statusCode).toBe(400);
    expect(amended.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('description');
    const wrongType = await send(t.name, 'PATCH', `/groups/${id}`, { description: 7 });
    expect(wrongType.statusCode).toBe(400);
  });
});

describe('a role’s description', () => {
  it('refuses one over 1000 characters on create and on amend', async () => {
    const t = await fixture.createTenant(`rd-${newId()}`);
    const created = await send(t.name, 'POST', '/roles', { name: 'long', description: LONG });
    expect(created.statusCode).toBe(400);
    expect(created.body).toContain('description');

    const role = await send(t.name, 'POST', '/roles', { name: 'ok', description: 'Reads' });
    const { id } = role.json<{ id: string }>();
    const amended = await send(t.name, 'PATCH', `/roles/${id}`, { description: LONG });
    expect(amended.statusCode).toBe(400);
    expect(amended.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('description');

    const list = await send(t.name, 'GET', '/roles?client=tenant');
    expect(
      list.json<{ items: { id: string; description: string | null }[] }>().items,
    ).toContainEqual(expect.objectContaining({ id, description: 'Reads' }));
  });
});

describe('descriptions in a tenant document', () => {
  it('are exported and imported for groups and roles', async () => {
    const t = await fixture.createTenant(`dd-${newId()}`);
    await send(t.name, 'POST', '/groups', { name: 'support', description: 'Helpdesk' });
    await send(t.name, 'POST', '/roles', { name: 'reader', description: 'Reads reports' });

    const document = await exportOf(t.name);
    expect(document.groups).toContainEqual(
      expect.objectContaining({ path: '/support', description: 'Helpdesk' }),
    );
    expect(document.roles).toContainEqual(
      expect.objectContaining({ name: 'reader', description: 'Reads reports' }),
    );

    const imported = await importDocument(document);
    expect(imported.statusCode, imported.body).toBe(201);
    const name = imported.json<{ tenant: { name: string } }>().tenant.name;
    const again = await exportOf(name);
    expect(again.groups).toContainEqual(
      expect.objectContaining({ path: '/support', description: 'Helpdesk' }),
    );
    expect(again.roles).toContainEqual(
      expect.objectContaining({ name: 'reader', description: 'Reads reports' }),
    );
  });

  it('refuses an import naming a description over 1000 characters, at its path', async () => {
    const t = await fixture.createTenant(`dd-${newId()}`);
    await send(t.name, 'POST', '/groups', { name: 'support' });
    await send(t.name, 'POST', '/roles', { name: 'reader' });
    const document = await exportOf(t.name);
    const groupIndex = document.groups.findIndex((group) => group.path === '/support');
    const roleIndex = document.roles.findIndex((role) => role.name === 'reader');
    const tampered = {
      ...document,
      groups: document.groups.map((group, index) =>
        index === groupIndex ? { ...group, description: LONG } : group,
      ),
      roles: document.roles.map((role, index) =>
        index === roleIndex ? { ...role, description: LONG } : role,
      ),
    };

    const res = await importDocument(tampered);
    expect(res.statusCode).toBe(400);
    const paths = res.json<{ errors: { path: string }[] }>().errors.map((error) => error.path);
    expect(paths).toContain(`document.groups[${String(groupIndex)}].description`);
    expect(paths).toContain(`document.roles[${String(roleIndex)}].description`);
  });
});
