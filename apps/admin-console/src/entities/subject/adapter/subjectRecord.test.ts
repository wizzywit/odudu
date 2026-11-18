import { expect, it } from 'vitest';
import record from '#/entities/subject/adapter/fixtures/subject.json';
import { amendSubject, deleteSubject, readSubject } from '#/entities/subject/adapter/subjectRecord';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const T = `${ACME_ADMIN}/subjects/${record.id}`;
const ADA = {
  id: record.id,
  type: 'user',
  username: 'ada',
  email: 'ada@example.com',
  enabled: true,
  createdAt: record.created_at,
};

it('reads a subject with its ETag, and amends it on that', async () => {
  const fake = fakeTransport({
    [`GET ${T}`]: json(record, 200, { etag: '"s1"' }),
    [`PATCH ${T}`]: json(record, 200, { etag: '"s2"' }),
  });
  const gateway = fake.transport.gateway;
  expect(await readSubject(gateway, 'acme', record.id)).toMatchObject({
    ok: true,
    etag: '"s1"',
    data: ADA,
  });
  expect(
    await amendSubject(gateway, 'acme', record.id, { username: 'ada2' }, '"s1"'),
  ).toMatchObject({ ok: true, etag: '"s2"', data: ADA });
  expect(fake.sent[1]).toMatchObject({ ifMatch: '"s1"', body: { username: 'ada2' } });
});

it('carries a pending email change on the read and on the amend', async () => {
  const pending = { ...record, pending_email: 'new@example.test' };
  const fake = fakeTransport({
    [`GET ${T}`]: json(pending, 200, { etag: '"s1"' }),
    [`PATCH ${T}`]: json(pending, 200, { etag: '"s2"' }),
  });
  const gateway = fake.transport.gateway;
  const want = { ok: true, data: { ...ADA, pendingEmail: 'new@example.test' } };
  expect(await readSubject(gateway, 'acme', record.id)).toMatchObject(want);
  expect(
    await amendSubject(gateway, 'acme', record.id, { email: 'new@example.test' }, '"s1"'),
  ).toMatchObject(want);
});

it('clears an emptied email, as the server keeps no empty one', async () => {
  const fake = fakeTransport({ [`PATCH ${T}`]: json(record, 200, { etag: '"s2"' }) });
  await amendSubject(fake.transport.gateway, 'acme', record.id, { email: '' }, '"s1"');
  expect(fake.sent[0]?.body).toEqual({ email: null });
});

it('deletes a subject by its id', async () => {
  const fake = fakeTransport({ [`DELETE ${T}`]: () => new Response(null, { status: 204 }) });
  expect(await deleteSubject(fake.transport.gateway, 'acme', record.id)).toMatchObject({
    ok: true,
  });
});
