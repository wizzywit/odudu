import { ASSIGNMENT_LIMIT } from '@odudu/contracts/admin';
import { TENANT_CAPABILITIES } from '@odudu/domain-tenant';
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

// Each set below is read whole, under one ETag, so what bounds the read is
// the bound on the write that replaces it.
describe('the sets the admin API replaces whole', () => {
  const ids = Array.from({ length: ASSIGNMENT_LIMIT + 1 }, () => newId());

  it.each([
    ['PUT /subjects/{id}/roles', 'subjects', 'roles', 'role_ids'],
    ['PUT /subjects/{id}/groups', 'subjects', 'groups', 'group_ids'],
    ['PUT /groups/{id}/roles', 'groups', 'roles', 'role_ids'],
    ['PUT /scopes/{id}/roles', 'scopes', 'roles', 'role_ids'],
  ])('refuse more than ASSIGNMENT_LIMIT entries: %s', async (_name, collection, tail, field) => {
    const t = await fixture.createTenant(`limit-${newId()}`);
    const token = await fixture.adminToken(t.name, [...TENANT_CAPABILITIES]);

    const res = await fixture.http.inject({
      method: 'PUT',
      url: `/admin/tenants/${t.name}/${collection}/${newId()}/${tail}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': '"any"',
      },
      payload: { [field]: ids },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ path: field }] });
  });
});
