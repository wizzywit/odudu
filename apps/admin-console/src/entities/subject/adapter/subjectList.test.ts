import { expect, it } from 'vitest';
import holders from '#/entities/subject/adapter/fixtures/holders.json';
import subjects from '#/entities/subject/adapter/fixtures/subject-list.json';
import { readSubjectCount, readSubjectPage } from '#/entities/subject/adapter/subjectList';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

it('lists subjects as domain subjects, a service one with no name', async () => {
  const fake = fakeTransport({ [`GET ${ACME_ADMIN}/subjects`]: json(subjects) });
  const result = await readSubjectPage(
    fake.transport.gateway,
    'acme',
    new URLSearchParams({ username: 'a' }),
  );
  expect(fake.sent[0]?.search.toString()).toBe('username=a');
  expect(result.ok && result.data.items).toHaveLength(8);
  expect(result.ok && result.data.items[0]).toEqual({
    id: '01a109b6-1e08-73b5-b63f-7e89c1af0ad1',
    type: 'service',
    username: null,
    email: null,
    enabled: true,
    createdAt: '2026-10-27T01:05:16.783Z',
  });
  expect(result.ok && result.data.items[5]).toMatchObject({
    username: 'ada',
    email: 'ada@example.com',
    createdAt: '2026-10-27T01:15:46.485Z',
  });
});

it('carries what a listing filtered by capability says each holds, and the cursor on', async () => {
  const fake = fakeTransport({ [`GET ${ACME_ADMIN}/subjects`]: json(holders) });
  const query = new URLSearchParams({ capability: 'tenant-admin' });
  const result = await readSubjectPage(fake.transport.gateway, 'acme', query);
  expect(fake.sent[0]?.search.get('capability')).toBe('tenant-admin');
  expect(result.ok && result.data.next).toBe(holders.next);
  expect(result.ok && result.data.items[1]).toEqual({
    id: '01a10a7d-5af3-7c7b-9a9d-a9563044e85d',
    type: 'user',
    username: 'linus',
    email: null,
    enabled: true,
    createdAt: '2026-10-05T05:15:49.870Z',
    adminCapabilities: [{ name: 'view-audit', direct: false }],
  });
});

it('counts with the same query', async () => {
  const fake = fakeTransport({
    [`GET ${ACME_ADMIN}/subjects/count`]: json({ count: 3, capped: false }),
  });
  const query = new URLSearchParams({ username: 'ADA' });
  expect(await readSubjectCount(fake.transport.gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { count: 3, capped: false },
  });
  expect(fake.sent[0]?.search.toString()).toBe('username=ADA');
});
