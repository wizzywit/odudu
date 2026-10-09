import { tenants, withTenant } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { listEffectiveRoles, type ListEffectiveRolesInput } from '#/usecase/effective-roles';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

interface Via {
  kind: string;
  group_id?: string;
  group_path?: string;
  parent_role_id?: string;
  parent_name?: string;
}

describe('GET /subjects/:id/effective-roles', () => {
  it('names every role held and each path it was reached by', async () => {
    const t = await fixture.createTenant(`eff-${newId()}`);
    const seeded = await withTenant(fixture.app.db, t.id, async (tx) => {
      const rolesRepo = roleRepository(tx);
      const direct = await rolesRepo.create({ tenantId: t.id, name: 'direct', clientId: null });
      const nested = await rolesRepo.create({ tenantId: t.id, name: 'nested', clientId: null });
      const inherited = await rolesRepo.create({
        tenantId: t.id,
        name: 'inherited',
        clientId: null,
      });
      await rolesRepo.addComposite(direct.id, nested.id);
      const groupsRepo = groupRepository(tx);
      const parent = await groupsRepo.create({ tenantId: t.id, name: 'org', parentId: null });
      const child = await groupsRepo.create({ tenantId: t.id, name: 'team', parentId: parent.id });
      await groupsRepo.mapRole(parent.id, inherited.id);
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await rolesRepo.assignToSubject(subject.id, direct.id);
      await groupsRepo.addToSubject(subject.id, child.id);
      return { subject: subject.id, direct, nested, inherited, parent };
    });
    const token = await fixture.adminToken(t.name, ['view-users']);

    const res = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${seeded.subject}/effective-roles`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { id: string; name: string; via: Via[] }[] }>().items;
    const byName = new Map(items.map((item) => [item.name, item.via]));
    expect([...byName.keys()].sort()).toEqual(['direct', 'inherited', 'nested']);
    expect(byName.get('direct')).toEqual([{ kind: 'direct' }]);
    expect(byName.get('nested')).toEqual([
      { kind: 'composite', parent_role_id: seeded.direct.id, parent_name: 'direct' },
    ]);
    expect(byName.get('inherited')).toEqual([
      { kind: 'group', group_id: seeded.parent.id, group_path: '/org' },
    ]);
  });

  it('pages the set in id order, each page carrying the paths of its own roles', async () => {
    const t = await fixture.createTenant(`eff-${newId()}`);
    const subjectId = await withTenant(fixture.app.db, t.id, async (tx) => {
      const repo = roleRepository(tx);
      const top = await repo.create({ tenantId: t.id, name: 'top', clientId: null });
      const subject = await subjectRepository(tx).create({ tenantId: t.id, type: 'user' });
      await repo.assignToSubject(subject.id, top.id);
      for (const name of ['a', 'b', 'c', 'd']) {
        await repo.addComposite(top.id, (await repo.create({ tenantId: t.id, name })).id);
      }
      return subject.id;
    });
    const token = await fixture.adminToken(t.name, ['view-users']);
    const base = `/admin/tenants/${t.name}/subjects/${subjectId}/effective-roles?limit=2`;

    const seen: { id: string; name: string; via: Via[] }[] = [];
    const sizes: number[] = [];
    let url: string | undefined = base;
    while (url !== undefined) {
      const res: LightMyRequestResponse = await fixture.http.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body: { items: { id: string; name: string; via: Via[] }[]; next?: string } = res.json();
      sizes.push(body.items.length);
      seen.push(...body.items);
      url = body.next === undefined ? undefined : `${base}&cursor=${encodeURIComponent(body.next)}`;
    }

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen.map((item) => item.id)).toEqual(seen.map((item) => item.id).sort());
    const topItem = seen.find((item) => item.name === 'top');
    expect(topItem?.via).toEqual([{ kind: 'direct' }]);
    expect(seen.find((item) => item.name === 'a')?.via).toEqual([
      { kind: 'composite', parent_role_id: topItem?.id, parent_name: 'top' },
    ]);
  });

  it('answers 404 for an id no subject holds, and 403 without view-users', async () => {
    const t = await fixture.createTenant(`eff-${newId()}`);
    const reader = await fixture.adminToken(t.name, ['view-users']);
    const missing = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}/effective-roles`,
      headers: { authorization: `Bearer ${reader}` },
    });
    expect(missing.statusCode).toBe(404);

    const outsider = await fixture.adminToken(t.name, ['manage-clients']);
    const refused = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/subjects/${newId()}/effective-roles`,
      headers: { authorization: `Bearer ${outsider}` },
    });
    expect(refused.statusCode).toBe(403);
  });
});

const CURSOR_KEY = new Uint8Array(32).fill(3);

function page(subjectId: string): ListEffectiveRolesInput {
  return {
    tenantId: newId(),
    subjectId,
    limit: 50,
    cursor: undefined,
    cursorKey: CURSOR_KEY,
  };
}

describe('listEffectiveRoles, probed with a foreign tenant_id', () => {
  it('finds no subject across tenants', async () => {
    await expectCrossTenantMethodProbe(fixture.app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${newId()}` });
        const role = await roleRepository(tx).create({ tenantId, name: 'r', clientId: null });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await roleRepository(tx).assignToSubject(subject.id, role.id);
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        const outcome = await listEffectiveRoles(tx, page(subjectId));
        expect(outcome.kind === 'ok' ? outcome.items.length : 0).toBe(1);
      },
      attempt: (tx, subjectId) => listEffectiveRoles(tx, page(subjectId)),
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'not_found' });
      },
    });
  });
});
