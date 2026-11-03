import { expect, it } from 'vitest';
import credentials from '#/pages/subjects/adapter/fixtures/credentials.json';
import lockout from '#/pages/subjects/adapter/fixtures/lockout.json';
import profile from '#/pages/subjects/adapter/fixtures/profile.json';
import {
  amendProfile,
  changeCredential,
  clearLockout,
  deleteCredential,
  readCredentials,
  readLockout,
  readProfile,
  readUsernameEditable,
  revokeRecoveryCodes,
} from '#/pages/subjects/adapter/subjects';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';

const T = '/console/api/admin/tenants/acme/subjects';
const ID = '01a0e72d-7fc7-7950-a1e7-1d079588f8b4';

it('reads and amends a profile on its ETag, the claims keeping their OIDC names', async () => {
  const fake = fakeTransport({
    [`GET ${T}/${ID}/profile`]: json(profile, 200, { etag: '"p1"' }),
    [`PATCH ${T}/${ID}/profile`]: json(profile, 200, { etag: '"p2"' }),
  });
  const gateway = fake.transport.gateway;
  const read = await readProfile(gateway, 'acme', ID);
  expect(read).toMatchObject({ ok: true, etag: '"p1"' });
  expect(read.ok && read.data).toEqual(profile);
  await amendProfile(gateway, 'acme', ID, { name: null }, '"p1"');
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"p1"', body: { name: null } });
});

it('clears an emptied claim, as the server keeps no empty one', async () => {
  const fake = fakeTransport({
    [`PATCH ${T}/${ID}/profile`]: json(profile, 200, { etag: '"p2"' }),
  });
  await amendProfile(
    fake.transport.gateway,
    'acme',
    ID,
    { name: '', nickname: 'ada', email_verified: true },
    '"p1"',
  );
  expect(fake.sent[0]?.body).toEqual({ name: null, nickname: 'ada', email_verified: true });
});

it('reads credentials as domain credentials, the recovery codes as one counted entry', async () => {
  const fake = fakeTransport({ [`GET ${T}/${ID}/credentials`]: json(credentials) });
  const result = await readCredentials(fake.transport.gateway, 'acme', ID);
  expect(result.ok && result.data).toEqual([
    {
      id: '01a1554b-bd12-7e43-943d-23bad4c55806',
      type: 'password',
      createdAt: '2026-10-19T17:53:09.356Z',
      expired: false,
    },
    {
      id: '1c0ec1ea-211d-4a02-aace-a5873c04b243',
      type: 'totp',
      createdAt: '2026-10-19T17:53:25.802Z',
    },
    { type: 'recovery-code', createdAt: '2026-10-19T17:53:26.613Z', recoveryCodeCount: 10 },
  ]);
});

it('reads a lockout as the domain one', async () => {
  const fake = fakeTransport({ [`GET ${T}/${ID}/lockout`]: json(lockout) });
  const result = await readLockout(fake.transport.gateway, 'acme', ID);
  expect(result.ok && result.data).toEqual({
    locked: true,
    lockedUntil: '2026-09-29T09:37:48.522Z',
    failureCount: 6,
    lastFailureAt: '2026-09-29T09:35:48.522Z',
  });
});

it('reaches the credential and lockout routes by the subject id', async () => {
  const gone = () => new Response(null, { status: 204 });
  const fake = fakeTransport({
    [`DELETE ${T}/${ID}/credentials/c1`]: gone,
    [`DELETE ${T}/${ID}/recovery-codes`]: gone,
    [`DELETE ${T}/${ID}/lockout`]: gone,
  });
  const gateway = fake.transport.gateway;
  expect(await deleteCredential(gateway, 'acme', ID, 'c1', false)).toMatchObject({ ok: true });
  expect(await revokeRecoveryCodes(gateway, 'acme', ID, true)).toMatchObject({ ok: true });
  expect(await clearLockout(gateway, 'acme', ID)).toMatchObject({ ok: true });
});

it('sends a credential change to the route its kind names', async () => {
  const gone = () => new Response(null, { status: 204 });
  const fake = fakeTransport({
    [`DELETE ${T}/${ID}/credentials/c1`]: gone,
    [`DELETE ${T}/${ID}/recovery-codes`]: gone,
    [`DELETE ${T}/${ID}/lockout`]: gone,
  });
  const gateway = fake.transport.gateway;
  await changeCredential(gateway, 'acme', ID, {
    kind: 'factor',
    credentialId: 'c1',
    endSessions: false,
  });
  await changeCredential(gateway, 'acme', ID, { kind: 'recovery-codes', requireNewSet: true });
  await changeCredential(gateway, 'acme', ID, { kind: 'lockout' });
  expect(fake.sent.map((sent) => `${sent.method} ${sent.path.split(`${ID}/`)[1] ?? ''}`)).toEqual([
    'DELETE credentials/c1',
    'DELETE recovery-codes',
    'DELETE lockout',
  ]);
});

it('says whether a new set is asked for, in the query the route reads', async () => {
  const gone = () => new Response(null, { status: 204 });
  const fake = fakeTransport({ [`DELETE ${T}/${ID}/recovery-codes`]: gone });
  const gateway = fake.transport.gateway;
  await revokeRecoveryCodes(gateway, 'acme', ID, true);
  await revokeRecoveryCodes(gateway, 'acme', ID, false);
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'require_new_set=true',
    'require_new_set=false',
  ]);
});

it('asks for the sessions to end in the removal’s own request, and in no other', async () => {
  const gone = () => new Response(null, { status: 204 });
  const fake = fakeTransport({
    [`DELETE ${T}/${ID}/credentials/c1`]: gone,
    [`DELETE ${T}/${ID}/credentials/c2`]: () => new Response('{}', { status: 404 }),
  });
  const gateway = fake.transport.gateway;
  const change = (credentialId: string, endSessions: boolean) =>
    changeCredential(gateway, 'acme', ID, { kind: 'factor', credentialId, endSessions });
  expect(await change('c1', false)).toMatchObject({ ok: true });
  expect(await change('c1', true)).toMatchObject({ ok: true });
  expect((await change('c2', true)).ok).toBe(false);
  expect(
    fake.sent.map((sent) => `${sent.path.split(`${ID}/`)[1] ?? ''}?${sent.search.toString()}`),
  ).toEqual([
    'credentials/c1?end_sessions=false',
    'credentials/c1?end_sessions=true',
    'credentials/c2?end_sessions=true',
  ]);
});

it('reads whether usernames can be renamed from the subjects’ username policy', async () => {
  const on = fakeTransport({ [`GET ${T}/username-policy`]: json({ username_editable: true }) });
  expect(await readUsernameEditable(on.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: true,
  });
  const refused = fakeTransport({
    [`GET ${T}/username-policy`]: problem(403, 'about:blank', 'Forbidden'),
  });
  expect(await readUsernameEditable(refused.transport.gateway, 'acme')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});
