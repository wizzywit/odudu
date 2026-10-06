import { ASSIGNMENT_LIMIT } from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
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

interface Held {
  name: string;
  client_key: string | null;
  via: { kind: string; group_path?: string; parent_name?: string }[];
}

async function read(tenant: string, subjectId: string, token: string) {
  return fixture.http.inject({
    method: 'GET',
    url: `/admin/tenants/${tenant}/subjects/${subjectId}/admin-capabilities`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /subjects/:id/admin-capabilities', () => {
  it('names each admin capability held and the paths it is held by, and no other role', async () => {
    const t = await fixture.createTenant(`caps-${newId()}`);
    const subjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (admin === null) throw new Error('no admin client');
      const roles = roleRepository(tx);
      const users = await roles.byName('manage-users', admin.id);
      const audit = await roles.byName('view-audit', admin.id);
      if (users === null || audit === null) throw new Error('no capability roles');
      const other = await roles.create({ tenantId: t.id, name: 'not-admin', clientId: null });
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await roles.assignToSubject(subject.id, users.id);
      await roles.assignToSubject(subject.id, other.id);
      const groups = groupRepository(tx);
      const team = await groups.create({ tenantId: t.id, name: 'auditors', parentId: null });
      await groups.mapRole(team.id, audit.id);
      await groups.addToSubject(subject.id, team.id);
      return subject.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await read(t.name, subjectId, token);

    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: Held[] }>().items;
    // manage-users nests view-users, so that is held too: through the composite.
    expect(items.map((item) => item.name).sort()).toEqual([
      'manage-users',
      'view-audit',
      'view-users',
    ]);
    expect(items.every((item) => item.client_key === ADMIN_CLIENT_ID)).toBe(true);
    const via = new Map(items.map((item) => [item.name, item.via]));
    expect(via.get('view-users')).toMatchObject([
      { kind: 'composite', parent_name: 'manage-users' },
    ]);
    expect(via.get('manage-users')).toEqual([{ kind: 'direct' }]);
    expect(via.get('view-audit')).toMatchObject([{ kind: 'group', group_path: '/auditors' }]);
  });

  it('carries a capability held only through a composite, whatever else the subject holds', async () => {
    const t = await fixture.createTenant(`caps-${newId()}`);
    const subjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const admin = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (admin === null) throw new Error('no admin client');
      const roles = roleRepository(tx);
      const keys = await roles.byName('manage-keys', admin.id);
      if (keys === null) throw new Error('no manage-keys');
      const wrapper = await roles.create({ tenantId: t.id, name: 'wrapper', clientId: null });
      await roles.addComposite(wrapper.id, keys.id);
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await roles.assignToSubject(subject.id, wrapper.id);
      return subject.id;
    });
    // A subject holding more roles than one page of effective roles would show.
    await fixture.owner.sql`
      with made as (
        insert into roles (id, tenant_id, name)
        select gen_random_uuid(), ${t.id}, 'filler-' || g from generate_series(1, ${ASSIGNMENT_LIMIT + 50}) g
        returning id)
      insert into subject_roles (tenant_id, subject_id, role_id)
      select ${t.id}, ${subjectId}, id from made`;
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await read(t.name, subjectId, token);

    const items = res.json<{ items: Held[] }>().items;
    expect(items.map((item) => item.name)).toEqual(['manage-keys']);
    expect(items[0]?.via).toMatchObject([{ kind: 'composite', parent_name: 'wrapper' }]);
  });

  it('answers 404 for an id no subject holds, and 403 without view-users', async () => {
    const t = await fixture.createTenant(`caps-${newId()}`);
    const reader = await fixture.adminToken(t.name, ['view-users']);
    expect((await read(t.name, newId(), reader)).statusCode).toBe(404);
    const outsider = await fixture.adminToken(t.name, ['manage-clients']);
    expect((await read(t.name, newId(), outsider)).statusCode).toBe(403);
  });
});
