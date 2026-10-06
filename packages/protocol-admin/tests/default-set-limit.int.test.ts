import { ASSIGNMENT_LIMIT } from '@odudu/contracts/admin';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import { groupRepository, roleRepository } from '@odudu/domain-authz';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
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

// Runs `act` while another transaction holds `lock`, and says whether it had
// finished by the time `wait` ms passed: a write that takes the lock waits.
async function finishesWhileHeld<R>(
  tenantId: string,
  lock: (tx: TenantScopedDatabase) => Promise<unknown>,
  act: () => Promise<R>,
  wait = 400,
): Promise<{ finished: boolean; result: R }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => {
    signalLocked = resolve;
  });
  const holder = withTenant(fixture.app.db, tenantId, async (tx) => {
    await lock(tx);
    signalLocked();
    await held;
  });
  await locked;
  const pending = act();
  const early = await Promise.race([
    pending.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, wait);
    }),
  ]);
  release();
  await holder;
  return { finished: early, result: await pending };
}

// A new subject is handed every default role and group at once, so a set of
// them past what a subject may hold would hand it more than the sets it is
// then read and replaced as.
describe('the roles and groups every new subject is handed', () => {
  it('stop at ASSIGNMENT_LIMIT roles, and refuse one more by either door', async () => {
    const t = await fixture.createTenant(`defaults-${newId()}`);
    const token = await fixture.adminToken(t.name, ['tenant-admin']);
    const spare = await withTenant(fixture.app.db, t.id, async (tx) => {
      for (let n = 0; n < ASSIGNMENT_LIMIT; n += 1) {
        await roleRepository(tx).create({
          tenantId: t.id,
          name: `default-${String(n)}`,
          defaultForNewSubjects: true,
        });
      }
      return roleRepository(tx).create({ tenantId: t.id, name: 'one-too-many' });
    });
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const created = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/roles`,
      headers,
      payload: { name: 'also-too-many', default_for_new_subjects: true },
    });
    const current = await fixture.http.inject({
      url: `/admin/tenants/${t.name}/roles/${spare.id}`,
      headers,
    });
    const flagged = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/roles/${spare.id}/default`,
      headers: { ...headers, 'if-match': String(current.headers.etag) },
      payload: { default: true },
    });

    expect(created.statusCode).toBe(409);
    expect(flagged.statusCode).toBe(409);
    expect(flagged.json<{ detail: string }>().detail).toContain(String(ASSIGNMENT_LIMIT));
  });

  it('are counted under the default-reach lock, so a concurrent default create waits', async () => {
    const t = await fixture.createTenant(`defaults-${newId()}`);
    const token = await fixture.adminToken(t.name, ['tenant-admin']);

    const { finished, result } = await finishesWhileHeld(
      t.id,
      (tx) =>
        tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('role_default_reach'), hashtext(current_setting('app.tenant_id')))`,
        ),
      () =>
        fixture.http.inject({
          method: 'POST',
          url: `/admin/tenants/${t.name}/roles`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: { name: 'waits', default_for_new_subjects: true },
        }),
    );

    expect(finished).toBe(false);
    expect(result.statusCode).toBe(201);
  });

  it('stop at ASSIGNMENT_LIMIT groups, and refuse one more', async () => {
    const t = await fixture.createTenant(`defaults-${newId()}`);
    const token = await fixture.adminToken(t.name, ['tenant-admin']);
    const spare = await withTenant(fixture.app.db, t.id, async (tx) => {
      for (let n = 0; n < ASSIGNMENT_LIMIT; n += 1) {
        const group = await groupRepository(tx).create({
          tenantId: t.id,
          name: `default-${String(n)}`,
          parentId: null,
        });
        await groupRepository(tx).setDefaultForNewSubjects(group.id, true);
      }
      return groupRepository(tx).create({ tenantId: t.id, name: 'one-too-many', parentId: null });
    });
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const current = await fixture.http.inject({
      url: `/admin/tenants/${t.name}/groups/${spare.id}`,
      headers,
    });
    const flagged = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/groups/${spare.id}/default`,
      headers: { ...headers, 'if-match': String(current.headers.etag) },
      payload: { default: true },
    });

    expect(flagged.statusCode).toBe(409);
  });
});
