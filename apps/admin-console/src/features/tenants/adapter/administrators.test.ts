import { expect, it } from 'vitest';
import {
  createSubject,
  findSubject,
  issuePassword,
  readAdminClients,
  readAdministratorPage,
  readClientRoles,
  readSubjectRoles,
  setSubjectRoles,
} from '#/features/tenants/adapter/administrators.ts';
import { fakeTransport, json } from '#/testing/fakeTransport.ts';

const T = '/console/api/admin/tenants/acme';
const SUBJECT = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  type: 'user',
  username: 'grace',
  email: null,
  enabled: true,
  created_at: '2026-09-28T08:41:53.858Z',
};

it("lists the tenant's administrators as the subjects holding tenant-admin", async () => {
  const fake = fakeTransport({ [`GET ${T}/subjects`]: json({ items: [SUBJECT] }) });
  const query = new URLSearchParams({ capability: 'tenant-admin' });
  expect(await readAdministratorPage(fake.transport.gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { items: [SUBJECT] },
  });
  expect(fake.sent[0]?.search.get('capability')).toBe('tenant-admin');
});

it('creates a subject, sending the email only when there is one, and finds one by username', async () => {
  const fake = fakeTransport({
    [`POST ${T}/subjects`]: json(SUBJECT, 201),
    [`GET ${T}/subjects`]: json({ items: [{ ...SUBJECT, username: 'grace2' }, SUBJECT] }),
  });
  await createSubject(fake.transport.gateway, 'acme', { username: 'grace', email: '' });
  await createSubject(fake.transport.gateway, 'acme', { username: 'grace', email: 'g@x.test' });
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { username: 'grace' },
    { username: 'grace', email: 'g@x.test' },
  ]);
  expect(await findSubject(fake.transport.gateway, 'acme', 'grace')).toMatchObject({
    ok: true,
    data: SUBJECT,
  });
  expect(fake.sent[2]?.search.get('username')).toBe('grace');
});

it('issues a one-time password', async () => {
  const fake = fakeTransport({
    [`POST ${T}/subjects/${SUBJECT.id}/password`]: json({ password: 'once' }, 201),
  });
  expect(await issuePassword(fake.transport.gateway, 'acme', SUBJECT.id)).toMatchObject({
    ok: true,
    data: { password: 'once' },
  });
});

it('reads the clients named odudu-admin and the roles of one client by name', async () => {
  const fake = fakeTransport({
    [`GET ${T}/clients`]: json({ items: [] }),
    [`GET ${T}/roles`]: json({ items: [] }),
  });
  await readAdminClients(fake.transport.gateway, 'acme');
  await readClientRoles(fake.transport.gateway, 'acme', 'c1', 'tenant-admin');
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual([
    'client_id=odudu-admin',
    'client=c1&name=tenant-admin',
  ]);
});

it("reads a subject's roles with their ETag and replaces them under If-Match", async () => {
  const roles = { items: [{ id: 'r1', name: 'reader', client_id: null, client_key: null }] };
  const fake = fakeTransport({
    [`GET ${T}/subjects/${SUBJECT.id}/roles`]: json(roles, 200, { etag: '"r1"' }),
    [`PUT ${T}/subjects/${SUBJECT.id}/roles`]: json(roles, 200, { etag: '"r2"' }),
  });
  expect(await readSubjectRoles(fake.transport.gateway, 'acme', SUBJECT.id)).toMatchObject({
    ok: true,
    etag: '"r1"',
  });
  await setSubjectRoles(fake.transport.gateway, 'acme', SUBJECT.id, ['r1', 'r2'], '"r1"');
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"r1"', body: { role_ids: ['r1', 'r2'] } });
});
