import { expect, it } from 'vitest';
import { exportAuditEvents, readAuditPage } from '#/shared/adapter/audit';
import { AUDIT } from '#/testing/auditFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

// The first response of the get-audit transcript, verbatim: one row written by a
// system administrator, with no name resolved.
const TRAIL = {
  items: [
    {
      id: '01a1873a-1b1d-74a0-b9d5-a48ae2bd2294',
      occurred_at: '2026-10-29T10:34:54.617Z',
      event_type: 'admin_mutation',
      action: 'session.end_all',
      outcome: 'allowed',
      actor_tenant_id: '0199aa00-0000-7000-8000-000000000001',
      actor_subject_id: '01a18727-6b60-76f6-9299-36e7692328a0',
      actor_client_id: '01a18727-6b13-713f-8865-d215040c7828',
      actor_name: null,
      actor_origin: 'system',
      resource_type: 'tenant',
      resource_id: '01a1873a-178d-7da0-912a-e976785881ac',
      request_id: '01a1873a-1b08-75cf-8194-c970aef1a0fa',
      ip: '172.20.0.1',
      detail: { ended: 0, remaining: 0, beyond_ceiling: 0 },
    },
  ],
};

// The first export of the get-auditcount-and-get-auditexport transcript: two NDJSON lines.
const EXPORT = [
  '{"id":"01a0ee8c-69d4-7064-bae0-23af3f0d9bf6","occurred_at":"2026-09-29T19:02:54.671Z","event_type":"admin_mutation","action":"subject.amend","outcome":"refused","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"uma","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8a-c8f6-7450-b486-861a66a87684","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"denied":["manage-tenant"]}}',
  '{"id":"01a0ee8c-69ce-7674-a090-e64e603e8a49","occurred_at":"2026-09-29T19:02:54.658Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a0ee8a-c394-7b49-942b-3dea70a962e7","actor_subject_id":"01a0ee8a-cc42-7dc9-a0bd-7fcd5dc9c35e","actor_client_id":"01a0ee8a-c3a0-7429-ab4a-4ecef6baf694","actor_name":"uma","actor_origin":"tenant","resource_type":"subject","resource_id":"01a0ee8c-67c6-7752-904b-584bbc614619","request_id":"01a0ee8c-69b5-7e9b-a23c-621c22a3eb69","ip":"172.22.0.1","detail":{"enabled":{"after":false,"before":true}}}',
].join('\n');

it('reads a page of the trail from the audit path, passing limit and cursor on', async () => {
  const fake = fakeTransport({ [`GET ${AUDIT}`]: json(TRAIL) });
  const query = new URLSearchParams({ action: 'session.end_all', limit: '1', after: 'a.b' });
  const result = await readAuditPage(fake.transport.gateway, 'acme', query);
  expect(result).toMatchObject({ ok: true, data: TRAIL });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: AUDIT });
  expect(fake.sent.at(-1)?.search.get('limit')).toBe('1');
  expect(fake.sent.at(-1)?.search.get('after')).toBe('a.b');
  expect(fake.sent.at(-1)?.search.get('action')).toBe('session.end_all');
});

it('exports the events as the text the server sent, GET with the filters as the query', async () => {
  const NDJSON = () =>
    new Response(EXPORT, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  const fake = fakeTransport({ [`GET ${AUDIT}/export`]: NDJSON });
  const { gateway } = fake.transport;
  const bare = await exportAuditEvents(gateway, 'acme', new URLSearchParams());
  expect(bare).toMatchObject({
    ok: true,
    data: { text: EXPORT, contentType: 'application/x-ndjson; charset=utf-8' },
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${AUDIT}/export` });
  expect(fake.sent.at(-1)?.search.toString()).toBe('');
  await exportAuditEvents(gateway, 'acme', new URLSearchParams({ action: 'subject.amend' }));
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${AUDIT}/export` });
  expect(fake.sent.at(-1)?.search.toString()).toBe('action=subject.amend');
});
