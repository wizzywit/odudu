import { withTenant } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clientScopeRepository,
  MANAGE_TENANTS,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
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

interface Surface {
  readonly tenant: { id: string; name: string };
  readonly adminClientId: string;
  readonly tenantAdminRoleId: string;
  readonly manageUsersRoleId: string;
  readonly openidScopeId: string;
}

async function builtinSurface(): Promise<Surface> {
  const tenant = await fixture.createTenant(`guard-${newId()}`);
  return withTenant(fixture.app.db, tenant.id, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: no built-in admin client');
    const role = async (name: string): Promise<string> => {
      const found = await roleRepository(tx).byName(name, adminClient.id);
      if (found === null) throw new Error(`fixture: no role ${name}`);
      return found.id;
    };
    const openid = await clientScopeRepository(tx).byName('openid');
    if (openid === null) throw new Error('fixture: no openid scope');
    return {
      tenant,
      adminClientId: adminClient.id,
      tenantAdminRoleId: await role(TENANT_ADMIN),
      manageUsersRoleId: await role('manage-users'),
      openidScopeId: openid.id,
    };
  });
}

interface Guard {
  readonly method: 'PATCH' | 'DELETE' | 'POST';
  readonly url: (s: Surface) => string;
  readonly body?: Record<string, unknown>;
  readonly action: string;
  readonly resourceId: (s: Surface) => string;
}

const GUARDS: Readonly<Record<string, Guard>> = {
  'disabling the built-in admin client': {
    method: 'PATCH',
    url: (s) => `/admin/tenants/${s.tenant.name}/clients/${s.adminClientId}`,
    body: { enabled: false },
    action: 'client.amend',
    resourceId: (s) => s.adminClientId,
  },
  'amending a guarded field of it': {
    method: 'PATCH',
    url: (s) => `/admin/tenants/${s.tenant.name}/clients/${s.adminClientId}`,
    body: { access_token_ttl_seconds: 600 },
    action: 'client.amend',
    resourceId: (s) => s.adminClientId,
  },
  'deleting it': {
    method: 'DELETE',
    url: (s) => `/admin/tenants/${s.tenant.name}/clients/${s.adminClientId}`,
    action: 'client.delete',
    resourceId: (s) => s.adminClientId,
  },
  'deleting a capability role': {
    method: 'DELETE',
    url: (s) => `/admin/tenants/${s.tenant.name}/roles/${s.tenantAdminRoleId}`,
    action: 'role.delete',
    resourceId: (s) => s.tenantAdminRoleId,
  },
  'removing a composite of one': {
    method: 'DELETE',
    url: (s) =>
      `/admin/tenants/${s.tenant.name}/roles/${s.tenantAdminRoleId}/composites/${s.manageUsersRoleId}`,
    action: 'role.composite_remove',
    resourceId: (s) => s.tenantAdminRoleId,
  },
  'unassigning a scope from the built-in admin client': {
    method: 'DELETE',
    url: (s) =>
      `/admin/tenants/${s.tenant.name}/scopes/${s.openidScopeId}/clients/${s.adminClientId}`,
    action: 'scope.unassign_from_client',
    resourceId: (s) => s.openidScopeId,
  },
  'deleting the openid scope': {
    method: 'DELETE',
    url: (s) => `/admin/tenants/${s.tenant.name}/scopes/${s.openidScopeId}`,
    action: 'scope.delete',
    resourceId: (s) => s.openidScopeId,
  },
};

describe('a 409 guarding the built-in admin surface writes a refused row', () => {
  it.each(Object.keys(GUARDS))('%s', async (name) => {
    const guard = GUARDS[name];
    if (guard === undefined) throw new Error(`no guard ${name}`);
    const s = await builtinSurface();
    const token = await fixture.adminToken(s.tenant.name, [TENANT_ADMIN]);

    const res = await fixture.http.inject({
      method: guard.method,
      url: guard.url(s),
      headers: {
        authorization: `Bearer ${token}`,
        ...(guard.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(guard.body === undefined ? {} : { payload: guard.body }),
    });

    expect(res.statusCode).toBe(409);
    const reason = res.json<{ detail: string }>().detail;
    const rows = await withTenant(fixture.app.db, s.tenant.id, (tx) =>
      auditRepository(tx).list({ limit: 50 }),
    );
    const refused = rows.filter((row) => row.action === guard.action && row.outcome === 'refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.resourceId).toBe(guard.resourceId(s));
    expect(refused[0]?.detail).toEqual({ reason });
  });

  it.each([
    ['PATCH /admin/tenants/{tenant}', '', 'tenant.amend'],
    ['PATCH /settings', '/settings', 'tenant.amend_settings'],
  ])('disabling the system tenant through %s', async (_name, suffix, action) => {
    const token = await fixture.systemAdminToken([MANAGE_TENANTS, 'manage-tenant']);
    const before = await withTenant(fixture.app.db, fixture.systemTenantId, (tx) =>
      auditRepository(tx).list({ limit: 200 }),
    );

    const res = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${SYSTEM_TENANT_NAME}${suffix}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(409);
    const after = await withTenant(fixture.app.db, fixture.systemTenantId, (tx) =>
      auditRepository(tx).list({ limit: 200 }),
    );
    const seen = new Set(before.map((row) => row.id));
    const refused = after.filter(
      (row) => !seen.has(row.id) && row.action === action && row.outcome === 'refused',
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.detail).toEqual({ reason: res.json<{ detail: string }>().detail });
  });
});
