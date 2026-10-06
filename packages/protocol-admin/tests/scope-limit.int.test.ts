import { SCOPE_LIMIT } from '@odudu/contracts/admin';
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
});
