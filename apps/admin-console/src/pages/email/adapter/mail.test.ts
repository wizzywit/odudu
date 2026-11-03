import { expect, it } from 'vitest';
import { readMailPage } from '#/pages/email/adapter/mail';
import { fakeTransport, json } from '#/testing/fakeTransport';

const MESSAGE = {
  id: '01a0e72d-7fc7-7950-a1e7-1d079588f8b4',
  to: 'a***@example.org',
  to_masked: true,
  subject: 'Verify your Acme account',
  status: 'failed',
  attempts: 5,
  last_error: 'connect ECONNREFUSED',
  created_at: '2026-09-28T08:41:53.858Z',
  next_attempt_at: '2026-09-28T09:41:53.858Z',
  sent_at: null,
};
const PATH = 'GET /console/api/admin/tenants/acme/mail';

it('reads one page of the tenant’s mail with the query it is given', async () => {
  const fake = fakeTransport({ [PATH]: json({ items: [MESSAGE], next: 'c2' }) });
  const query = new URLSearchParams({ status: 'failed', limit: '20' });
  expect(await readMailPage(fake.transport.gateway, 'acme', query)).toMatchObject({
    ok: true,
    data: { items: [MESSAGE], next: 'c2' },
  });
  expect(fake.sent.map((sent) => sent.search.toString())).toEqual(['status=failed&limit=20']);
});

it('refuses an answer whose message names no status', async () => {
  const bare = { ...MESSAGE, status: undefined };
  const fake = fakeTransport({ [PATH]: json({ items: [bare] }) });
  expect(await readMailPage(fake.transport.gateway, 'acme', new URLSearchParams())).toMatchObject({
    ok: false,
    kind: 'schema',
  });
});
