import { expect, it } from 'vitest';
import {
  amendProfile,
  amendSubject,
  changeCredential,
  clearLockout,
  createSubject,
  deleteCredential,
  deleteSubject,
  readCredentials,
  readLockout,
  readProfile,
  readSubject,
  readSubjectCount,
  readSubjectPage,
  readUsernameEditable,
  revokeRecoveryCodes,
} from '#/features/subjects/adapter/subjects.ts';
import { fakeTransport, json, problem } from '#/testing/fakeTransport.ts';

const T = '/console/api/admin/tenants/acme/subjects';
const ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';
const ADA = {
  id: ID,
  type: 'user',
  username: 'ada',
  email: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};

it('lists and counts subjects with the query it is given', async () => {
  const fake = fakeTransport({
    [`GET ${T}`]: json({ items: [ADA], next: 'c2' }),
    [`GET ${T}/count`]: json({ count: 1, capped: false }),
  });
  const query = new URLSearchParams({ username: 'a', capability: 'manage-users' });
  expect(await readSubjectPage(fake.transport.gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { items: [ADA], next: 'c2' },
  });
  expect(await readSubjectCount(fake.transport.gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { count: 1 },
  });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'username=a&capability=manage-users',
    'username=a&capability=manage-users',
  ]);
});

it('creates a subject, sending the email only when there is one', async () => {
  const fake = fakeTransport({ [`POST ${T}`]: json(ADA, 201) });
  await createSubject(fake.transport.gateway, 'acme', { username: 'ada', email: 'ada@x.test' });
  await createSubject(fake.transport.gateway, 'acme', { username: 'ada', email: '' });
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { username: 'ada', email: 'ada@x.test' },
    { username: 'ada' },
  ]);
});

it('reads a subject and its profile with their ETags, and amends each on one', async () => {
  const profile = { name: 'Ada', email_verified: true, phone_number_verified: false };
  const fake = fakeTransport({
    [`GET ${T}/${ID}`]: json(ADA, 200, { etag: '"s1"' }),
    [`PATCH ${T}/${ID}`]: json(ADA, 200, { etag: '"s2"' }),
    [`GET ${T}/${ID}/profile`]: json(fullProfile(profile), 200, { etag: '"p1"' }),
    [`PATCH ${T}/${ID}/profile`]: json(fullProfile(profile), 200, { etag: '"p2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readSubject(gateway, 'acme', ID)).toMatchObject({ ok: true, etag: '"s1"' });
  expect(await readProfile(gateway, 'acme', ID)).toMatchObject({ ok: true, etag: '"p1"' });
  await amendSubject(gateway, 'acme', ID, { username: 'ada2' }, '"s1"');
  await amendProfile(gateway, 'acme', ID, { name: null }, '"p1"');
  expect(fake.sent.filter((sent) => sent.method === 'PATCH')).toMatchObject([
    { ifMatch: '"s1"', body: { username: 'ada2' } },
    { ifMatch: '"p1"', body: { name: null } },
  ]);
});

it('clears an emptied email or claim, as the server keeps no empty one', async () => {
  const fake = fakeTransport({
    [`PATCH ${T}/${ID}`]: json(ADA, 200, { etag: '"s2"' }),
    [`PATCH ${T}/${ID}/profile`]: json(
      fullProfile({ name: 'Ada', email_verified: true, phone_number_verified: false }),
      200,
      { etag: '"p2"' },
    ),
  });
  const gateway = fake.transport.gateway;
  await amendSubject(gateway, 'acme', ID, { username: 'ada', email: '' }, '"s1"');
  await amendProfile(
    gateway,
    'acme',
    ID,
    { name: '', nickname: 'ada', email_verified: true },
    '"p1"',
  );
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { username: 'ada', email: null },
    { name: null, nickname: 'ada', email_verified: true },
  ]);
});

it('reaches the credential, lockout and deletion routes by the subject id', async () => {
  const fake = fakeTransport({
    [`GET ${T}/${ID}/credentials`]: json({ items: [] }),
    [`DELETE ${T}/${ID}/credentials/c1`]: () => new Response(null, { status: 204 }),
    [`DELETE ${T}/${ID}/recovery-codes`]: () => new Response(null, { status: 204 }),
    [`GET ${T}/${ID}/lockout`]: json({
      locked: false,
      locked_until: null,
      failure_count: 0,
      last_failure_at: null,
    }),
    [`DELETE ${T}/${ID}/lockout`]: () => new Response(null, { status: 204 }),
    [`DELETE ${T}/${ID}`]: () => new Response(null, { status: 204 }),
  });
  const gateway = fake.transport.gateway;
  expect(await readCredentials(gateway, 'acme', ID)).toMatchObject({ ok: true });
  expect(await deleteCredential(gateway, 'acme', ID, 'c1')).toMatchObject({ ok: true });
  expect(await revokeRecoveryCodes(gateway, 'acme', ID)).toMatchObject({ ok: true });
  expect(await readLockout(gateway, 'acme', ID)).toMatchObject({
    ok: true,
    data: { locked: false },
  });
  expect(await clearLockout(gateway, 'acme', ID)).toMatchObject({ ok: true });
  expect(await deleteSubject(gateway, 'acme', ID)).toMatchObject({ ok: true });
});

it('sends a credential change to the route its kind names', async () => {
  const gone = () => new Response(null, { status: 204 });
  const fake = fakeTransport({
    [`DELETE ${T}/${ID}/credentials/c1`]: gone,
    [`DELETE ${T}/${ID}/recovery-codes`]: gone,
    [`DELETE ${T}/${ID}/lockout`]: gone,
  });
  const gateway = fake.transport.gateway;
  await changeCredential(gateway, 'acme', ID, { kind: 'factor', credentialId: 'c1' });
  await changeCredential(gateway, 'acme', ID, { kind: 'recovery-codes' });
  await changeCredential(gateway, 'acme', ID, { kind: 'lockout' });
  expect(fake.sent.map((sent) => `${sent.method} ${sent.path.split(`${ID}/`)[1] ?? ''}`)).toEqual([
    'DELETE credentials/c1',
    'DELETE recovery-codes',
    'DELETE lockout',
  ]);
});

it('reads whether usernames can be renamed from the subjects’ username policy', async () => {
  const on = fakeTransport({
    'GET /console/api/admin/tenants/acme/subjects/username-policy': json({
      username_editable: true,
    }),
  });
  expect(await readUsernameEditable(on.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: true,
  });
  const refused = fakeTransport({
    'GET /console/api/admin/tenants/acme/subjects/username-policy': problem(
      403,
      'about:blank',
      'Forbidden',
    ),
  });
  expect(await readUsernameEditable(refused.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});

function fullProfile(extra: Record<string, unknown>) {
  const claims = [
    'name',
    'given_name',
    'family_name',
    'middle_name',
    'nickname',
    'preferred_username',
    'profile',
    'picture',
    'website',
    'gender',
    'birthdate',
    'zoneinfo',
    'locale',
    'phone_number',
    'address_formatted',
    'address_street',
    'address_locality',
    'address_region',
    'address_postal_code',
    'address_country',
  ];
  return {
    ...Object.fromEntries(claims.map((claim) => [claim, null])),
    email_verified: false,
    phone_number_verified: false,
    profile_updated_at: null,
    ...extra,
  };
}
