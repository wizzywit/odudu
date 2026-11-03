import { expect, it } from 'vitest';
import created from '#/entities/subject/adapter/fixtures/created-subject.json';
import password from '#/entities/subject/adapter/fixtures/password.json';
import subjects from '#/entities/subject/adapter/fixtures/subject-list.json';
import {
  createSubject,
  findSubject,
  issuePassword,
} from '#/entities/subject/adapter/subjectCreation';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const ADA = {
  id: created.id,
  type: 'user',
  username: 'ada',
  email: 'ada@example.com',
  enabled: true,
  createdAt: created.created_at,
};

it('creates a subject, sending the email only when there is one', async () => {
  const fake = fakeTransport({ [`POST ${ACME_ADMIN}/subjects`]: json(created, 201) });
  const gateway = fake.transport.gateway;
  const first = await createSubject(gateway, 'acme', { username: 'ada', email: '' });
  await createSubject(gateway, 'acme', { username: 'ada', email: 'ada@example.com' });
  expect(first).toMatchObject({ ok: true, data: ADA });
  expect(fake.sent.map((sent) => sent.body)).toEqual([
    { username: 'ada' },
    { username: 'ada', email: 'ada@example.com' },
  ]);
});

it('finds the subject whose username is the whole of the one asked for', async () => {
  const fake = fakeTransport({ [`GET ${ACME_ADMIN}/subjects`]: json(subjects) });
  const found = await findSubject(fake.transport.gateway, 'acme', 'ada');
  expect(fake.sent[0]?.search.get('username')).toBe('ada');
  expect(found.ok && found.data).toMatchObject({ username: 'ada', email: 'ada@example.com' });
  const none = await findSubject(fake.transport.gateway, 'acme', 'adal');
  expect(none).toMatchObject({ ok: true, data: null });
});

it('issues a one-time password', async () => {
  const fake = fakeTransport({
    [`POST ${ACME_ADMIN}/subjects/${created.id}/password`]: json(password, 201),
  });
  expect(await issuePassword(fake.transport.gateway, 'acme', created.id)).toMatchObject({
    ok: true,
    data: password,
  });
});
