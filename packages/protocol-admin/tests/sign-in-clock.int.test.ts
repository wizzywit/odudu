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

it('signs in when the fixture clock has fallen behind the database clock', async () => {
  const t = await fixture.createTenant(`flake-${newId()}`);
  const client = await createSignInClient(fixture, t.id);
  await createPasswordSubject(fixture, t.id, 'ada', 'correct horse battery staple');
  // What 6 minutes of a loaded run does to a clock that only moves when told to.
  fixture.clock.set(new Date(Date.now() - 6 * 60 * 1000));
  expect(
    await signInForRefreshToken(fixture, t.name, client, 'ada', 'correct horse battery staple'),
  ).toEqual(expect.any(String));
});
