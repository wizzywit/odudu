import { newId } from '@odudu/kernel';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import {
  createPasswordSubject,
  createSignInClient,
  signInForRefreshToken,
} from '#/testing/sign-in';

let fixture: AdminFixture;
beforeAll(async () => {
  fixture = await startAdminFixture();
}, 120_000);
afterAll(async () => {
  await fixture.stop();
});

it('signs in after real time has passed that the fixture clock never saw', async () => {
  const t = await fixture.createTenant(`flake-${newId()}`);
  const client = await createSignInClient(fixture, t.id);
  await createPasswordSubject(fixture, t.id, 'ada', 'correct horse battery staple');
  const token = await fixture.adminToken(t.name, ['manage-tenant']);
  const patched = await fixture.http.inject({
    method: 'PATCH',
    url: `/admin/tenants/${t.name}/settings`,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: { authorization_code_ttl_seconds: 5 },
  });
  expect(patched.statusCode).toBe(200);
  // The database's clock runs on while the fixture's stands still: a code
  // issued now, at the fixture's old time plus five seconds, is already past.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  expect(
    await signInForRefreshToken(fixture, t.name, client, 'ada', 'correct horse battery staple'),
  ).toEqual(expect.any(String));
});
