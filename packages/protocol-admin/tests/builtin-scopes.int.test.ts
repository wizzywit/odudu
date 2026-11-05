import { SCOPE_LIMIT, tenantDocumentSchema } from '@odudu/contracts/admin';
import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import {
  ADMIN_CLIENT_ID,
  clientRepository,
  clientScopeRepository,
  clientScopes,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  TENANT_DEFAULT_SCOPE_NAMES,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { scopeImpact } from '#/usecase/scopes';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Problem {
  type: string;
  status: number;
  detail: string;
}

const auth = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

function del(
  token: string,
  tenant: string,
  id: string,
  query = '',
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'DELETE',
    url: `/admin/tenants/${tenant}/scopes/${id}${query}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function get(token: string, url: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

function restore(token: string, tenant: string): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant}/scopes/restore-builtins`,
    headers: { authorization: `Bearer ${token}` },
  });
}

async function scopeId(tenantId: string, name: string): Promise<string> {
  const scope = await withTenant(fixture.app.db, tenantId, (tx) =>
    clientScopeRepository(tx).byName(name),
  );
  if (scope === null) throw new Error(`fixture: no scope ${name}`);
  return scope.id;
}

async function plainRole(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId, name: `plain-${newId()}` });
    return role.id;
  });
}

async function tenantAdminRole(tenantId: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    const role = await roleRepository(tx).byName(TENANT_ADMIN, admin?.id ?? null);
    if (role === null) throw new Error('fixture: no tenant-admin role');
    return role.id;
  });
}

async function mapRole(token: string, tenant: string, id: string, roleId: string) {
  const read = await get(token, `/admin/tenants/${tenant}/scopes/${id}/roles`);
  const res = await fixture.http.inject({
    method: 'PUT',
    url: `/admin/tenants/${tenant}/scopes/${id}/roles`,
    headers: { ...auth(token), 'if-match': String(read.headers.etag) },
    payload: { role_ids: [roleId] },
  });
  expect(res.statusCode).toBe(200);
}

// Two clients carry the scope, the tenant's own admin client and one added here, and one role is mapped to it.
async function loadedTenant(name: string) {
  const t = await fixture.createTenant(`acme-${newId()}`);
  const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
  const id = await scopeId(t.id, name);
  const client = await fixture.createConfidentialClient(t.name, {});
  await withTenant(fixture.app.db, t.id, (tx) =>
    clientScopeRepository(tx).assignOrUpdate(client.id, id, 'default'),
  );
  await mapRole(token, t.name, id, await plainRole(t.id));
  return { t, token, id };
}

async function audited(tenantId: string, action: string) {
  const rows = await withTenant(fixture.app.db, tenantId, (tx) =>
    auditRepository(tx).list({ limit: 100 }),
  );
  return rows.filter((row) => row.action === action);
}

describe('DELETE /admin/tenants/{t}/scopes/{id} — a built-in scope', () => {
  it('is refused without a confirmation, naming the scope and what it would take', async () => {
    const { t, token, id } = await loadedTenant('profile');

    const res = await del(token, t.name, id);

    expect(res.statusCode).toBe(422);
    const problem = res.json<Problem>();
    expect(problem.type).toBe('about:blank#builtin-scope-confirmation');
    expect(problem.detail).toContain('profile');
    // The built-in admin and MCP clients and the one the helper registers.
    expect(problem.detail).toContain('3 clients');
    expect(problem.detail).toContain('1 role');
    expect(problem.detail).toContain('confirm=profile');
    expect(
      await withTenant(fixture.app.db, t.id, (tx) => clientScopeRepository(tx).byId(id)),
    ).not.toBeNull();
    const [row, ...rest] = await audited(t.id, 'scope.delete');
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ outcome: 'refused', resourceId: id });
    expect(row?.detail).toMatchObject({
      builtin: true,
      client_assignments: 3,
      role_mappings: 1,
    });
  });

  it('is refused when the confirmation names another scope', async () => {
    const { t, token, id } = await loadedTenant('email');

    const res = await del(token, t.name, id, '?confirm=profile');

    expect(res.statusCode).toBe(422);
    expect(
      await withTenant(fixture.app.db, t.id, (tx) => clientScopeRepository(tx).byId(id)),
    ).not.toBeNull();
  });

  it('is deleted, with its assignment and role mapping, once the caller names it', async () => {
    const { t, token, id } = await loadedTenant('groups');

    const res = await del(token, t.name, id, '?confirm=groups');

    expect(res.statusCode).toBe(204);
    expect(
      await withTenant(fixture.app.db, t.id, (tx) => clientScopeRepository(tx).byId(id)),
    ).toBeNull();
    const left = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.execute(sql`SELECT 1 FROM client_scope_roles WHERE client_scope_id = ${id}`),
    );
    expect([...left]).toEqual([]);
    const [row, ...rest] = await audited(t.id, 'scope.delete');
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ outcome: 'allowed', resourceId: id });
    expect(row?.detail).toMatchObject({
      builtin: true,
      client_assignments: 3,
      role_mappings: 1,
    });
  });

  it('keeps openid refused, confirmation or not', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const id = await scopeId(t.id, 'openid');

    for (const query of ['', '?confirm=openid']) {
      const res = await del(token, t.name, id, query);
      expect(res.statusCode, query).toBe(409);
      expect(res.json<Problem>().type).toBe('about:blank');
    }
    expect(
      await withTenant(fixture.app.db, t.id, (tx) => clientScopeRepository(tx).byId(id)),
    ).not.toBeNull();
  });

  it('is judged by the capability ceiling before anything is asked of the caller', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const id = await scopeId(t.id, 'roles');
    const adminRole = await tenantAdminRole(t.id);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.execute(
        sql`INSERT INTO client_scope_roles (tenant_id, client_scope_id, role_id) VALUES (${t.id}, ${id}, ${adminRole})`,
      ),
    );

    for (const query of ['', '?confirm=roles']) {
      expect((await del(token, t.name, id, query)).statusCode, query).toBe(403);
    }
    expect(
      await withTenant(fixture.app.db, t.id, (tx) => clientScopeRepository(tx).byId(id)),
    ).not.toBeNull();
  });
});

describe('a scope created under a built-in name', () => {
  it('is built in: its delete needs the confirmation, and a restore leaves it alone', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const original = await scopeId(t.id, 'email');
    expect((await del(token, t.name, original, '?confirm=email')).statusCode).toBe(204);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: auth(token),
      payload: { name: 'email', description: 'mine' },
    });
    const id = created.json<{ id: string }>().id;

    expect((await del(token, t.name, id)).statusCode).toBe(422);
    expect((await restore(token, t.name)).json()).toEqual({ created: [] });
    expect(
      (await get(token, `/admin/tenants/${t.name}/scopes/${id}`)).json<{ description: string }>()
        .description,
    ).toBe('mine');
  });
});

describe('DELETE /admin/tenants/{t}/scopes/{id} — an ordinary scope', () => {
  it('needs no confirmation, and its audit row carries the cascade counts', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: auth(token),
      payload: { name: `reports-${newId()}` },
    });
    const id = created.json<{ id: string }>().id;
    const client = await fixture.createConfidentialClient(t.name, {});
    await withTenant(fixture.app.db, t.id, (tx) =>
      clientScopeRepository(tx).assignOrUpdate(client.id, id, 'optional'),
    );

    const res = await del(token, t.name, id);

    expect(res.statusCode).toBe(204);
    const [row] = await audited(t.id, 'scope.delete');
    expect(row).toMatchObject({ outcome: 'allowed' });
    expect(row?.detail).toMatchObject({
      builtin: false,
      client_assignments: 1,
      role_mappings: 0,
    });
  });

  it('is not found in another tenant, with or without a confirmation', async () => {
    const mine = await fixture.createTenant(`acme-${newId()}`);
    const theirs = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(mine.name, ['manage-tenant']);
    const foreign = await scopeId(theirs.id, 'profile');

    for (const query of ['', '?confirm=profile']) {
      expect((await del(token, mine.name, foreign, query)).statusCode, query).toBe(404);
    }
    expect(
      await withTenant(fixture.app.db, theirs.id, (tx) => clientScopeRepository(tx).byId(foreign)),
    ).not.toBeNull();
    expect(
      (await get(token, `/admin/tenants/${mine.name}/scopes/${foreign}/impact`)).statusCode,
    ).toBe(404);
  });
});

describe('GET /admin/tenants/{t}/scopes/{id}/impact', () => {
  it('counts what a deletion takes and says whether the scope is built in', async () => {
    const { t, token, id } = await loadedTenant('phone');

    const res = await get(token, `/admin/tenants/${t.name}/scopes/${id}/impact`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      builtin: true,
      client_assignments: { count: 3, capped: false },
      role_mappings: { count: 1, capped: false },
    });
  });

  it('says an ordinary scope is not built in', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: auth(token),
      payload: { name: `reports-${newId()}` },
    });

    const res = await get(
      token,
      `/admin/tenants/${t.name}/scopes/${created.json<{ id: string }>().id}/impact`,
    );

    expect(res.json()).toMatchObject({
      builtin: false,
      client_assignments: { count: 0 },
      role_mappings: { count: 0 },
    });
  });

  it('stops counting at its cap, and reads only its own tenant, probed with a foreign tenant_id', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const client = await clientRepository(tx).create({
          tenantId,
          clientId: `probe-${newId()}`,
          name: 'probe',
          type: 'public',
          secretHash: null,
        });
        const scope = await clientScopeRepository(tx).create({ tenantId, name: 'probe' });
        await clientScopeRepository(tx).assignOrUpdate(client.id, scope.id, 'default');
        return { tenantId, scopeId: scope.id };
      },
      verifySeeded: async (tx, seeded) => {
        const outcome = await scopeImpact(tx, seeded.scopeId, { cap: 0 });
        expect(outcome).toMatchObject({
          kind: 'ok',
          impact: { client_assignments: { count: 0, capped: true } },
        });
      },
      attempt: (tx, seeded) => scopeImpact(tx, seeded.scopeId),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
    });
  });
});

describe('GET /admin/tenants/{t}/scopes/builtins', () => {
  it('lists every built-in in provisioning order with whether the tenant has it', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const repository = clientScopeRepository(tx);
      const scope = await repository.byName('address');
      if (scope !== null) await repository.delete(scope.id);
    });

    const res = await get(token, `/admin/tenants/${t.name}/scopes/builtins`);

    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: { name: string; present: boolean }[] }>().items).toEqual(
      TENANT_DEFAULT_SCOPE_NAMES.map((name) => ({ name, present: name !== 'address' })),
    );
  });
});

describe('POST /admin/tenants/{t}/scopes/restore-builtins', () => {
  async function without(tenantId: string, names: readonly string[]): Promise<void> {
    await withTenant(fixture.app.db, tenantId, async (tx) => {
      const repository = clientScopeRepository(tx);
      for (const name of names) {
        const scope = await repository.byName(name);
        if (scope !== null) await repository.delete(scope.id);
      }
    });
  }

  it('recreates what is missing with the shipped settings, and a second call creates none', async () => {
    const pristine = await fixture.createTenant(`acme-${newId()}`);
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await without(t.id, ['roles', 'offline_access']);

    const first = await restore(token, t.name);
    const second = await restore(token, t.name);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ created: ['roles', 'offline_access'] });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ created: [] });
    const shipped = async (tenantId: string) =>
      withTenant(fixture.app.db, tenantId, async (tx) =>
        (await clientScopeRepository(tx).allForTenant())
          .map((scope) => ({
            name: scope.name,
            description: scope.description,
            includeInIdToken: scope.includeInIdToken,
            includeInAccessToken: scope.includeInAccessToken,
            defaultClientAssignment: scope.defaultClientAssignment,
            consentText: scope.consentText,
            displayOrder: scope.displayOrder,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    expect(await shipped(t.id)).toEqual(await shipped(pristine.id));
    const rows = await audited(t.id, 'scope.restore_builtins');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'allowed', resourceType: 'scope' });
    expect(rows[0]?.detail).toEqual({ created: ['roles', 'offline_access'] });
  });

  it('leaves a built-in an administrator edited exactly as it is', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    const id = await scopeId(t.id, 'profile');
    const read = await get(token, `/admin/tenants/${t.name}/scopes/${id}`);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/scopes/${id}`,
      headers: { ...auth(token), 'if-match': String(read.headers.etag) },
      payload: { description: 'edited', default_client_assignment: null },
    });
    await without(t.id, ['groups']);

    expect((await restore(token, t.name)).json()).toEqual({ created: ['groups'] });
    const after = await get(token, `/admin/tenants/${t.name}/scopes/${id}`);

    expect(after.json()).toMatchObject({ description: 'edited', default_client_assignment: null });
  });

  it('brings back neither the assignments nor the role mappings the deletion removed', async () => {
    const { t, token, id } = await loadedTenant('roles');
    expect((await del(token, t.name, id, '?confirm=roles')).statusCode).toBe(204);

    expect((await restore(token, t.name)).json()).toEqual({ created: ['roles'] });

    const restored = await scopeId(t.id, 'roles');
    const impact = await get(token, `/admin/tenants/${t.name}/scopes/${restored}/impact`);
    expect(impact.json()).toMatchObject({
      client_assignments: { count: 0 },
      role_mappings: { count: 0 },
    });
  });

  it('exports a deleted-then-restored built-in as a built-in', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-clients']);
    const exportScopes = async () => {
      const res = await get(token, `/admin/tenants/${t.name}/export`);
      return tenantDocumentSchema.parse(JSON.parse(res.payload)).scopes;
    };
    await without(t.id, ['email']);
    expect((await exportScopes()).map((scope) => scope.name)).not.toContain('email');

    await restore(token, t.name);

    const email = (await exportScopes()).find((scope) => scope.name === 'email');
    expect(email).toMatchObject({ builtin: true });
  });

  it('is refused, creating nothing, with 409 when the missing scopes would pass the limit', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await without(t.id, ['roles']);
    await withTenant(fixture.app.db, t.id, async (tx) => {
      const held = await clientScopeRepository(tx).countUpTo(SCOPE_LIMIT);
      await tx.insert(clientScopes).values(
        Array.from({ length: SCOPE_LIMIT - held }, (_, index) => ({
          id: newId(),
          tenantId: t.id,
          name: `filler-${String(index)}`,
        })),
      );
    });

    const res = await restore(token, t.name);

    expect(res.statusCode).toBe(409);
    const [row] = await audited(t.id, 'scope.restore_builtins');
    expect(row).toMatchObject({ outcome: 'refused' });
  });

  it('touches no other tenant', async () => {
    const mine = await fixture.createTenant(`acme-${newId()}`);
    const theirs = await fixture.createTenant(`acme-${newId()}`);
    await without(theirs.id, ['email']);
    const token = await fixture.adminToken(mine.name, ['manage-tenant']);

    expect((await restore(token, mine.name)).json()).toEqual({ created: [] });

    expect(
      await withTenant(fixture.app.db, theirs.id, (tx) =>
        clientScopeRepository(tx).byName('email'),
      ),
    ).toBeNull();
  });
});

describe('the built-in scope routes', () => {
  it('are refused for every capability but manage-tenant', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const id = await scopeId(t.id, 'profile');
    for (const capability of TENANT_CAPABILITIES) {
      if (capability === 'manage-tenant') continue;
      const token = await fixture.adminToken(t.name, [capability]);
      const base = `/admin/tenants/${t.name}/scopes`;
      expect((await get(token, `${base}/${id}/impact`)).statusCode, `impact ${capability}`).toBe(
        403,
      );
      expect((await get(token, `${base}/builtins`)).statusCode, `builtins ${capability}`).toBe(403);
      expect((await restore(token, t.name)).statusCode, `restore ${capability}`).toBe(403);
    }
  });
});
