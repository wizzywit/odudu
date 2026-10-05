import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminReachOfGroups, adminReachOfRoles } from '#/service/capability-ceiling';
import { etagOf } from '#/service/etag';
import { storedFields } from '#/testing/stored-fields';
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  tail: string,
  payload?: unknown,
  capabilities: readonly string[] = ['tenant-admin'],
): Promise<LightMyRequestResponse> {
  const token = await fixture.adminToken(tenantName, [...capabilities]);
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${tenantName}${tail}`,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
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

async function role(tenantName: string, name: string): Promise<string> {
  const res = await call(tenantName, 'POST', '/roles', { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

async function nest(tenantId: string, parent: string, child: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) =>
    roleRepository(tx).addComposite(parent, child),
  );
}

async function group(tenantName: string, name: string, parentId?: string): Promise<string> {
  const res = await call(tenantName, 'POST', '/groups', {
    name,
    ...(parentId === undefined ? {} : { parent_id: parentId }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

async function mapRole(tenantId: string, groupId: string, roleId: string): Promise<void> {
  await withTenant(fixture.app.db, tenantId, (tx) => groupRepository(tx).mapRole(groupId, roleId));
}

interface Reached {
  id: string;
  admin_reach: string[];
  subtree_admin_reach?: string[];
}

describe("a role's admin_reach", () => {
  it('names what it reaches however deep it nests it, on every answer that carries a role', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const outer = await role(t.name, 'outer');
    const middle = await role(t.name, 'middle');
    const plain = await role(t.name, 'plain');
    await nest(t.id, outer, middle);
    await nest(t.id, middle, await capabilityRoleId(t.id, 'manage-users'));

    const read = await call(t.name, 'GET', `/roles/${outer}`);
    expect(read.json<Reached>().admin_reach).toEqual(['view-users', 'manage-users']);
    const listed = await call(t.name, 'GET', '/roles?client=tenant');
    expect(
      listed.json<{ items: Reached[] }>().items.map((each) => [each.id, each.admin_reach]),
    ).toEqual(
      expect.arrayContaining([
        [outer, ['view-users', 'manage-users']],
        [middle, ['view-users', 'manage-users']],
        [plain, []],
      ]),
    );
    const composites = await call(t.name, 'GET', `/roles/${outer}/composites`);
    expect(composites.json<{ items: Reached[] }>().items).toEqual([
      expect.objectContaining({ id: middle, admin_reach: ['view-users', 'manage-users'] }),
    ]);
    const amended = await call(t.name, 'PATCH', `/roles/${outer}`, { description: 'x' });
    expect(amended.json<Reached>().admin_reach).toEqual(['view-users', 'manage-users']);
    const created = await call(t.name, 'POST', '/roles', { name: 'fresh' });
    expect(created.json<Reached>().admin_reach).toEqual([]);
  });

  it('is what the default refusal names, and stays outside the ETag', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const outer = await role(t.name, 'outer');
    const before = await call(t.name, 'GET', `/roles/${outer}`);
    const middle = await role(t.name, 'middle');
    await nest(t.id, outer, middle);
    await nest(t.id, middle, await capabilityRoleId(t.id, 'view-audit'));

    const after = await call(t.name, 'GET', `/roles/${outer}`);
    expect(after.json<Reached>().admin_reach).toEqual(['view-audit']);
    expect(after.headers.etag).toBe(before.headers.etag);
    expect(after.headers.etag).toBe(etagOf(storedFields(after.json())));

    const refused = await call(t.name, 'PUT', `/roles/${outer}/default`, { default: true });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ detail: string }>().detail).toMatch(/would reach: view-audit$/u);
  });

  it('counts Full as everything it carries', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const full = await call(
      t.name,
      'GET',
      `/roles/${await capabilityRoleId(t.id, 'tenant-admin')}`,
    );
    expect(full.json<Reached>().admin_reach).toEqual([
      'view-users',
      'manage-users',
      'manage-clients',
      'manage-tenant',
      'manage-keys',
      'manage-sessions',
      'view-audit',
    ]);
  });
});

describe("a group's admin_reach and subtree_admin_reach", () => {
  it('names what membership hands out, and what deleting it would take away', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const top = await group(t.name, 'top');
    const mid = await group(t.name, 'mid', top);
    const leaf = await group(t.name, 'leaf', mid);
    const bundle = await role(t.name, 'bundle');
    await nest(t.id, bundle, await capabilityRoleId(t.id, 'view-audit'));
    await mapRole(t.id, top, bundle);
    await mapRole(t.id, leaf, await capabilityRoleId(t.id, 'manage-keys'));

    const midRecord = await call(t.name, 'GET', `/groups/${mid}`);
    expect(midRecord.json<Reached>()).toMatchObject({
      admin_reach: ['view-audit'],
      subtree_admin_reach: ['manage-keys', 'view-audit'],
    });
    const leafRecord = await call(t.name, 'GET', `/groups/${leaf}`);
    expect(leafRecord.json<Reached>().admin_reach).toEqual(['manage-keys', 'view-audit']);

    const level = await call(t.name, 'GET', `/groups?parent=${top}`);
    const items = level.json<{ items: Reached[] }>().items;
    expect(items).toEqual([expect.objectContaining({ id: mid, admin_reach: ['view-audit'] })]);
    expect(items[0]).not.toHaveProperty('subtree_admin_reach');

    const amended = await call(t.name, 'PATCH', `/groups/${mid}`, { description: 'x' });
    expect(amended.json<Reached>()).toMatchObject({
      admin_reach: ['view-audit'],
      subtree_admin_reach: ['manage-keys', 'view-audit'],
    });
    const created = await call(t.name, 'POST', '/groups', { name: 'under', parent_id: top });
    expect(created.json<Reached>()).toMatchObject({
      admin_reach: ['view-audit'],
      subtree_admin_reach: ['view-audit'],
    });
  });

  it('stays outside the ETag when a group above gains a role', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const top = await group(t.name, 'top');
    const child = await group(t.name, 'child', top);
    const before = await call(t.name, 'GET', `/groups/${child}`);
    await mapRole(t.id, top, await capabilityRoleId(t.id, 'view-users'));
    const after = await call(t.name, 'GET', `/groups/${child}`);
    expect(after.json<Reached>().admin_reach).toEqual(['view-users']);
    expect(after.headers.etag).toBe(before.headers.etag);
  });
});

describe('PATCH /groups/{id} onto a parent already holding the name', () => {
  it('answers 409 and changes nothing', async () => {
    const t = await fixture.createTenant(`reach-${newId()}`);
    const eng = await group(t.name, 'eng');
    const ops = await group(t.name, 'ops', eng);
    const finance = await group(t.name, 'finance');
    await group(t.name, 'ops', finance);

    const res = await call(t.name, 'PATCH', `/groups/${ops}`, { parent_id: finance });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json<{ detail: string }>().detail).toBe('a group named "ops" already exists there');
    const read = await call(t.name, 'GET', `/groups/${ops}`);
    expect(read.json<{ path: string }>().path).toBe('/eng/ops');
  });
});

describe('the batched reach reads, probed with a foreign tenant_id', () => {
  it('see nothing of another tenant', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const client = await clientRepository(tx).create({
          tenantId,
          clientId: ADMIN_CLIENT_ID,
          name: 'admin',
          type: 'public',
          secretHash: null,
        });
        const capability = await roleRepository(tx).create({
          tenantId,
          name: 'view-audit',
          clientId: client.id,
        });
        const bundle = await roleRepository(tx).create({ tenantId, name: 'bundle' });
        await roleRepository(tx).addComposite(bundle.id, capability.id);
        const holder = await groupRepository(tx).create({
          tenantId,
          name: 'holder',
          parentId: null,
        });
        await groupRepository(tx).mapRole(holder.id, bundle.id);
        return { role: bundle.id, group: holder.id };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await adminReachOfRoles(tx, [seeded.role])).toEqual(
          new Map([[seeded.role, ['view-audit']]]),
        );
        expect(await adminReachOfGroups(tx, [seeded.group])).toEqual(
          new Map([[seeded.group, ['view-audit']]]),
        );
      },
      attempt: async (tx, seeded) => ({
        roles: [...(await adminReachOfRoles(tx, [seeded.role])).values()],
        groups: [...(await adminReachOfGroups(tx, [seeded.group])).values()],
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({ roles: [[]], groups: [[]] });
      },
    });
  });
});
