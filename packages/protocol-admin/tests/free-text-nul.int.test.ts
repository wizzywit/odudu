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

// A text column cannot hold U+0000, so a create naming one is the caller's
// error and must answer 400 with the field, never a server fault.
describe('a NUL in the free text of a create', () => {
  it.each([
    ['groups', 'name', {}],
    ['groups', 'description', { name: 'g' }],
    ['roles', 'name', {}],
    ['roles', 'description', { name: 'r' }],
    ['subjects', 'username', {}],
    ['subjects', 'email', { username: 'u' }],
  ])('is refused on POST /%s %s with 400 naming it', async (collection, field, rest) => {
    const t = await fixture.createTenant(`nul-${newId()}`);
    const token = await fixture.adminToken(t.name, ['manage-tenant', 'manage-users']);
    const unique = field === 'name' || field === 'username' ? {} : suffixed(rest);
    const res = await fixture.http.inject({
      method: 'POST',
      url: `/admin/tenants/${t.name}/${collection}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { ...unique, [field]: 'a\u0000b' },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).toContain(field);
  });
});

function suffixed(rest: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, `${value}-${newId()}`]),
  );
}
