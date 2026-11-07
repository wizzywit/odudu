import { GROUP_LIMIT, ROLE_LIMIT } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { groups, roles } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// A tenant defines at most ROLE_LIMIT roles and GROUP_LIMIT groups, as it does
// scopes: the create that would pass the limit is a 409 for everyone, and a
// tenant that already holds more keeps what it has.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const held = (tenantId: string) =>
  withTenant(fixture.app.db, tenantId, async (tx) => ({
    roles: (await tx.select({ id: roles.id }).from(roles)).length,
    groups: (await tx.select({ id: groups.id }).from(groups)).length,
  }));

async function fillRoles(tenantId: string, upTo: number): Promise<void> {
  const have = (await held(tenantId)).roles;
  await fixture.owner.db.execute(sql`
    insert into roles (id, tenant_id, name)
    select gen_random_uuid(), ${tenantId}::uuid, 'filler-' || g from generate_series(1, ${upTo - have}) g
  `);
}

async function fillGroups(tenantId: string, upTo: number): Promise<void> {
  const have = (await held(tenantId)).groups;
  await fixture.owner.db.execute(sql`
    insert into groups (id, tenant_id, name, path)
    select gen_random_uuid(), ${tenantId}::uuid, 'filler-' || g, '/filler-' || g
      from generate_series(1, ${upTo - have}) g
  `);
}

function post(tenant: string, route: string, token: string, payload: unknown) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant}/${route}`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: payload as never,
  });
}

describe('roles', () => {
  it('are created up to the limit, and the next create is a 409 that names it', async () => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fillRoles(t.id, ROLE_LIMIT - 1);
    const last = await post(t.name, 'roles', token, { name: 'the-last' });
    expect(last.statusCode).toBe(201);
    expect((await held(t.id)).roles).toBe(ROLE_LIMIT);
    const refused = await post(t.name, 'roles', token, { name: 'one-too-many' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      title: 'Conflict',
      detail: `a tenant defines at most ${String(ROLE_LIMIT)} roles`,
    });
    expect((await held(t.id)).roles).toBe(ROLE_LIMIT);
  });

  it('are refused the same way for a role that would be a default, and a client’s own role', async () => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fillRoles(t.id, ROLE_LIMIT);
    for (const body of [{ name: 'x', default_for_new_subjects: true }, { name: 'y' }]) {
      expect((await post(t.name, 'roles', token, body)).statusCode).toBe(409);
    }
  });

  it('are left alone in a tenant that holds more than the limit: only a create is refused', async () => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fillRoles(t.id, ROLE_LIMIT + 25);
    const list = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles?limit=5`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect((await post(t.name, 'roles', token, { name: 'more' })).statusCode).toBe(409);
    expect((await held(t.id)).roles).toBe(ROLE_LIMIT + 25);
  });

  it('are counted for one tenant only', async () => {
    const full = await fixture.createTenant(`lim-${newId()}`);
    const other = await fixture.createTenant(`lim-${newId()}`);
    await fillRoles(full.id, ROLE_LIMIT);
    const token = await fixture.adminToken(other.name, ['manage-tenant']);
    expect((await post(other.name, 'roles', token, { name: 'fine' })).statusCode).toBe(201);
  });
});

describe('creates made all at once at the limit', () => {
  it.each([
    ['roles', ROLE_LIMIT, fillRoles],
    ['groups', GROUP_LIMIT, fillGroups],
  ] as const)('admit exactly the one place left in %s', async (route, limit, fill) => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fill(t.id, limit - 1);
    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post(t.name, route, token, { name: `race-${String(i)}` }),
      ),
    );
    expect(answers.map((a) => a.statusCode).sort()).toEqual([
      201, 409, 409, 409, 409, 409, 409, 409,
    ]);
    expect((await held(t.id))[route]).toBe(limit);
  });
});

describe('groups', () => {
  it('are created up to the limit, and the next create is a 409 that names it', async () => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fillGroups(t.id, GROUP_LIMIT - 1);
    const last = await post(t.name, 'groups', token, { name: 'the-last' });
    expect(last.statusCode).toBe(201);
    expect((await held(t.id)).groups).toBe(GROUP_LIMIT);
    const refused = await post(t.name, 'groups', token, { name: 'one-too-many' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      title: 'Conflict',
      detail: `a tenant defines at most ${String(GROUP_LIMIT)} groups`,
    });
    expect((await held(t.id)).groups).toBe(GROUP_LIMIT);
  });

  it('are refused under a parent too, and left alone in a tenant that holds more', async () => {
    const t = await fixture.createTenant(`lim-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'view-users']);
    const parent = await post(t.name, 'groups', token, { name: 'parent' });
    const parentId = parent.json<{ id: string }>().id;
    await fillGroups(t.id, GROUP_LIMIT + 10);
    expect(
      (await post(t.name, 'groups', token, { name: 'c', parent_id: parentId })).statusCode,
    ).toBe(409);
    expect((await held(t.id)).groups).toBe(GROUP_LIMIT + 10);
  });
});
