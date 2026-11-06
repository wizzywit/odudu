import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const POOL = 2;

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture({ poolMax: POOL });
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

describe('keyed POSTs on a pool no larger than they need', () => {
  it('all settle when more arrive together than the pool has connections', async () => {
    const t = await fixture.createTenant(`pool-${newId()}`);
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
    const subject = await fixture.createSubject(t.name, `s-${newId()}`);
    // The route resolves the caller's capabilities on the pool before it
    // answers, so a request holding a connection for the whole call waits on
    // a second one.
    const call = () =>
      fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/subjects/${subject.id}/password-reset`,
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': `k-${newId()}` },
      });
    const timeout = new Promise<'hung'>((resolve) => {
      setTimeout(() => {
        resolve('hung');
      }, 15_000);
    });
    const settled = await Promise.race([
      Promise.all([call(), call(), call(), call(), call()]),
      timeout,
    ]);
    expect(settled).not.toBe('hung');
  }, 40_000);
});
