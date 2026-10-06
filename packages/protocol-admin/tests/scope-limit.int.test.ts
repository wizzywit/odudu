import { SCOPE_LIMIT } from '@odudu/contracts/admin';
import { withTenant, type TenantScopedDatabase } from '@odudu/db';
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

// Discovery advertises every scope of the tenant in one document, so the
// tenant's scopes are what bounds that document.
describe('the scopes of a tenant', () => {
  it('stop at SCOPE_LIMIT, and a scope past it is refused', async () => {
    const t = await fixture.createTenant(`scopes-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);
    await fixture.owner.sql`
      insert into client_scopes (id, tenant_id, name)
      select gen_random_uuid(), ${t.id}, 'filler-' || g
        from generate_series(1, ${SCOPE_LIMIT} - (select count(*) from client_scopes where tenant_id = ${t.id})) g`;

    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/scopes`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { name: 'one-too-many' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain(String(SCOPE_LIMIT));
  });

  it('are counted under the tenant row lock, so a concurrent create waits for the count', async () => {
    const t = await fixture.createTenant(`scopes-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant']);

    const { finished, result } = await finishesWhileHeld(
      t.id,
      (tx) => tx.execute(sql`select id from tenants where id = ${t.id} for no key update`),
      () =>
        fixture.http.inject({
          method: 'POST',
          url: `/admin/tenants/${t.name}/scopes`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: { name: 'waits' },
        }),
    );

    expect(finished).toBe(false);
    expect(result.statusCode).toBe(201);
  });
});
