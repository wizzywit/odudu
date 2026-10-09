import { tenantDocumentSchema, type TenantDocument } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { clientRepository, clientScopeRepository } from '@odudu/domain-tenant';
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

async function call(
  tenantName: string,
  capabilities: readonly string[],
  method: 'GET' | 'POST' | 'PATCH',
  tail: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, [...capabilities]);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

interface WireScope {
  id: string;
  name: string;
  default_client_assignment: 'default' | 'optional' | null;
}

async function scopes(tenantName: string): Promise<WireScope[]> {
  const res = await call(tenantName, ['manage-tenant'], 'GET', '/scopes?limit=200');
  return res.json<{ items: WireScope[] }>().items;
}

async function scopeNamed(tenantName: string, name: string): Promise<WireScope> {
  const found = (await scopes(tenantName)).find((scope) => scope.name === name);
  if (found === undefined) throw new Error(`fixture: no scope ${name}`);
  return found;
}

async function assignmentsOf(tenantId: string, oauthClientId: string): Promise<string[]> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId(oauthClientId);
    if (client === null) throw new Error(`fixture: no client ${oauthClientId}`);
    const rows = await clientScopeRepository(tx).forClientByAssignment(client.id);
    return rows.map((row) => `${row.scope.name}:${row.assignment}`).sort();
  });
}

async function adminCreatedClient(tenantName: string): Promise<string> {
  const res = await call(tenantName, ['manage-clients'], 'POST', '/clients', {
    client_id: `app-${newId()}`,
    redirect_uris: ['https://rp.example/cb'],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ client_id: string }>().client_id;
}

async function registeredClient(tenantName: string): Promise<string> {
  const policy = await call(tenantName, ['manage-tenant'], 'PATCH', '/settings', {
    client_registration_policy: 'open',
  });
  expect(policy.statusCode, policy.body).toBe(200);
  const res = await fixture.http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/clients-registrations/openid-connect`,
    payload: JSON.stringify({ redirect_uris: ['https://rp.example/cb'] }),
    headers: { 'content-type': 'application/json' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ client_id: string }>().client_id;
}

describe('a scope’s default_client_assignment', () => {
  it('reads back what a new tenant provisions', async () => {
    const t = await fixture.createTenant(`dcs-${newId()}`);
    const byName = new Map(
      (await scopes(t.name)).map((scope) => [scope.name, scope.default_client_assignment]),
    );
    expect(Object.fromEntries(byName)).toEqual({
      openid: 'default',
      profile: 'default',
      email: 'default',
      address: 'default',
      phone: 'default',
      roles: 'default',
      groups: 'default',
      offline_access: 'optional',
    });
  });

  it.each([
    ['an administrator', adminCreatedClient],
    ['dynamic registration', registeredClient],
  ])('decides what a client created by %s is assigned', async (_label, create) => {
    const t = await fixture.createTenant(`dcs-${newId()}`);
    const created = await call(t.name, ['manage-tenant'], 'POST', '/scopes', {
      name: 'reports:read',
      default_client_assignment: 'optional',
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json<WireScope>().default_client_assignment).toBe('optional');
    await call(t.name, ['manage-tenant'], 'POST', '/scopes', { name: 'reports:write' });
    const phone = await scopeNamed(t.name, 'phone');
    const unset = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${phone.id}`, {
      default_client_assignment: null,
    });
    expect(unset.statusCode, unset.body).toBe(200);
    const email = await scopeNamed(t.name, 'email');
    await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${email.id}`, {
      default_client_assignment: 'optional',
    });

    const assigned = await assignmentsOf(t.id, await create(t.name));
    expect(assigned).toEqual([
      'address:default',
      'email:optional',
      'groups:default',
      'offline_access:optional',
      'openid:default',
      'profile:default',
      'reports:read:optional',
      'roles:default',
    ]);
  });

  it('refuses a value that is neither default, optional nor null, naming the field', async () => {
    const t = await fixture.createTenant(`dcs-${newId()}`);
    const openid = await scopeNamed(t.name, 'openid');
    const res = await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${openid.id}`, {
      default_client_assignment: 'always',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(
      'default_client_assignment',
    );
    const created = await call(t.name, ['manage-tenant'], 'POST', '/scopes', {
      name: 'x',
      default_client_assignment: 'always',
    });
    expect(created.statusCode).toBe(400);
  });

  it('travels in a tenant document', async () => {
    const t = await fixture.createTenant(`dcs-${newId()}`);
    await call(t.name, ['manage-tenant'], 'POST', '/scopes', {
      name: 'reports:read',
      default_client_assignment: 'default',
    });
    const phone = await scopeNamed(t.name, 'phone');
    await call(t.name, ['manage-tenant'], 'PATCH', `/scopes/${phone.id}`, {
      default_client_assignment: null,
    });
    const token = await fixture.systemAdminToken(['manage-tenants', 'tenant-admin']);
    const exportOf = async (name: string): Promise<TenantDocument> => {
      const res = await fixture.http.inject({
        method: 'GET',
        url: `/admin/tenants/${name}/export`,
        headers: { authorization: `Bearer ${token}` },
      });
      return tenantDocumentSchema.parse(JSON.parse(res.payload));
    };
    const document = await exportOf(t.name);
    const imported = await fixture.http.inject({
      method: 'POST',
      url: '/admin/tenant-imports',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: `imp-${newId()}`, document }),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const again = await exportOf(imported.json<{ tenant: { name: string } }>().tenant.name);
    const assignment = (name: string) =>
      again.scopes.find((scope) => scope.name === name)?.default_client_assignment;
    expect(assignment('reports:read')).toBe('default');
    expect(assignment('phone')).toBeNull();
    expect(assignment('offline_access')).toBe('optional');
  });
});
