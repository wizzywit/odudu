import { withTenant } from '@odudu/db';
import { groupRepository, groups, roleRepository, roles } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { lockDefaultReach } from '#/usecase/default-reach';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const waitingSchema = (rows: unknown): number =>
  Array.isArray(rows) && typeof (rows[0] as { waiting?: unknown } | undefined)?.waiting === 'number'
    ? (rows[0] as { waiting: number }).waiting
    : 0;

async function awaitBlockedRequest(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = await fixture.owner.db.execute(
      sql`select count(*)::int as waiting from pg_locks where not granted`,
    );
    if (waitingSchema(rows) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the request never blocked; the two writes did not overlap');
}

// The other writer holds a row lock and then asks for the default-reach lock,
// the order every default-reach writer takes them in. The request below must
// queue behind that row before it takes the advisory lock; if it took the
// advisory lock first, each would wait on the other and one would be aborted.
async function againstRowHolder(
  tenantId: string,
  holdRow: Parameters<typeof withTenant>[2],
  request: () => Promise<LightMyRequestResponse>,
): Promise<LightMyRequestResponse> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => undefined;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holderDone = withTenant(fixture.app.db, tenantId, async (tx) => {
    await holdRow(tx);
    held();
    await released;
    await lockDefaultReach(tx);
  });
  await holding;
  const answered = request();
  await awaitBlockedRequest();
  release();
  await holderDone;
  return answered;
}

async function auth(tenantName: string): Promise<string> {
  return fixture.adminToken(tenantName, ['tenant-admin']);
}

describe('the default-reach lock comes after every row lock a write needs', () => {
  it('lets a group-roles replacement queue behind a composite writer holding the role', async () => {
    const t = await fixture.createTenant(`lock-${newId()}`);
    const { groupId, roleId } = await withTenant(fixture.app.db, t.id, async (tx) => {
      const group = await groupRepository(tx).create({
        tenantId: t.id,
        name: 'everyone',
        parentId: null,
      });
      await groupRepository(tx).setDefaultForNewSubjects(group.id, true);
      const role = await roleRepository(tx).create({ tenantId: t.id, name: 'reader' });
      return { groupId: group.id, roleId: role.id };
    });
    const token = await auth(t.name);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/groups/${groupId}/roles`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await againstRowHolder(
      t.id,
      async (tx) => {
        await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).for('update');
      },
      () =>
        fixture.http.inject({
          method: 'PUT',
          url: `/admin/tenants/${t.name}/groups/${groupId}/roles`,
          headers: { authorization: `Bearer ${token}`, 'if-match': String(read.headers.etag) },
          payload: { role_ids: [roleId] },
        }),
    );
    expect(res.statusCode, res.body).toBe(200);
  });

  it('lets a reparent queue behind a default writer holding a descendant', async () => {
    const t = await fixture.createTenant(`lock-${newId()}`);
    const { parentId, childId, rootId } = await withTenant(fixture.app.db, t.id, async (tx) => {
      const parent = await groupRepository(tx).create({
        tenantId: t.id,
        name: 'staff',
        parentId: null,
      });
      const child = await groupRepository(tx).create({
        tenantId: t.id,
        name: 'everyone',
        parentId: parent.id,
      });
      const root = await groupRepository(tx).create({
        tenantId: t.id,
        name: 'company',
        parentId: null,
      });
      return { parentId: parent.id, childId: child.id, rootId: root.id };
    });
    const token = await auth(t.name);

    const res = await againstRowHolder(
      t.id,
      async (tx) => {
        await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, childId)).for('update');
      },
      () =>
        fixture.http.inject({
          method: 'PATCH',
          url: `/admin/tenants/${t.name}/groups/${parentId}`,
          headers: { authorization: `Bearer ${token}` },
          payload: { parent_id: rootId },
        }),
    );
    expect(res.statusCode, res.body).toBe(200);
  });
});
