import { expect, it } from 'vitest';
import trail from '#/entities/audit-event/adapter/fixtures/audit-page.json';
import nextPage from '#/entities/audit-event/adapter/fixtures/audit-page-next.json';
import { readAuditPage } from '#/entities/audit-event/adapter/auditPage';
import { AUDIT } from '#/testing/auditFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

// audit-page.json is the first response of the get-audit transcript, verbatim:
// one row written by a system administrator, with no name resolved.
// audit-page-next.json is the documented example of listAuditResponseSchema
// (its one row is the contract's example) with a `next` cursor added, since
// no transcript shows a second page.
it('reads a page of the trail from the audit path, passing limit and cursor on', async () => {
  const fake = fakeTransport({ [`GET ${AUDIT}`]: json(trail) });
  const query = new URLSearchParams({ action: 'session.end_all', limit: '1', after: 'a.b' });
  const result = await readAuditPage(fake.transport.gateway, 'acme', query);
  expect(result).toMatchObject({ ok: true, data: trail });
  expect(result.ok && result.data.next).toBeUndefined();
  expect(result.ok && result.data.items[0]).toMatchObject({
    action: 'session.end_all',
    actor_name: null,
    actor_origin: 'system',
    detail: { ended: 0, remaining: 0, beyond_ceiling: 0 },
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: AUDIT });
  expect(fake.sent.at(-1)?.search.get('limit')).toBe('1');
  expect(fake.sent.at(-1)?.search.get('after')).toBe('a.b');
  expect(fake.sent.at(-1)?.search.get('action')).toBe('session.end_all');
});

it('carries the cursor of a page that has another after it, and a named actor', async () => {
  const fake = fakeTransport({ [`GET ${AUDIT}`]: json(nextPage) });
  const result = await readAuditPage(fake.transport.gateway, 'acme', new URLSearchParams());
  expect(result.ok && result.data.next).toBe(nextPage.next);
  expect(result.ok && result.data.items).toEqual(nextPage.items);
  expect(result.ok && result.data.items[0]?.actor_name).toBe('ada');
});
