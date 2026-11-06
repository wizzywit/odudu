import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

const started: AdminFixture[] = [];
afterAll(async () => {
  for (const fixture of started) await fixture.stop();
});

async function onPool(poolMax: number) {
  const fixture = await startAdminFixture({ poolMax });
  started.push(fixture);
  const t = await fixture.createTenant(`pool-${newId()}`);
  const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);
  const subject = await fixture.createSubject(t.name, `s-${newId()}`);
  // The route resolves the caller's capabilities on the pool before it
  // answers, so a request holding a connection for the whole call waits on a
  // second one.
  const keyed = () =>
    fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/subjects/${subject.id}/password-reset`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `k-${newId()}` },
    });
  const unkeyed = () =>
    fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/whoami`,
      headers: { authorization: `Bearer ${token}` },
    });
  return { keyed, unkeyed };
}

function within<T>(promise: Promise<T>): Promise<T | 'hung'> {
  const timeout = new Promise<'hung'>((resolve) => {
    setTimeout(() => {
      resolve('hung');
    }, 20_000);
  });
  return Promise.race([promise, timeout]);
}

describe('keyed POSTs against the size of the pool', () => {
  it.each([2, 3, 10])(
    'all settle when more arrive together than a pool of %i carries',
    async (pool) => {
      const { keyed } = await onPool(pool);
      const settled = await within(Promise.all(Array.from({ length: 12 }, () => keyed())));
      expect(settled).not.toBe('hung');
    },
    90_000,
  );

  it('refuses a keyed call on a pool of one rather than hang, and still serves the rest', async () => {
    const { keyed, unkeyed } = await onPool(1);
    const res = await within(keyed());
    expect(res).not.toBe('hung');
    if (res === 'hung') return;
    expect(res.statusCode).toBe(503);
    expect(res.json<{ type: string }>().type).toBe('about:blank#idempotency-unavailable');
    const other = await within(unkeyed());
    expect(other).not.toBe('hung');
    if (other !== 'hung') expect(other.statusCode).toBe(200);
  }, 90_000);
});
