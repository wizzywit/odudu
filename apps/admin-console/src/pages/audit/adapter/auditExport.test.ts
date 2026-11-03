import { expect, it } from 'vitest';
import exported from '#/pages/audit/adapter/fixtures/audit-export.ndjson?raw';
import { exportAuditEvents } from '#/pages/audit/adapter/auditExport';
import { AUDIT } from '#/testing/auditFixtures';
import { fakeTransport } from '#/testing/fakeTransport';

// audit-export.ndjson is the first export of the get-auditcount-and-get-auditexport
// transcript, verbatim: two NDJSON lines, the server's newline after each.
it('exports the events as the text the server sent, GET with the filters as the query', async () => {
  const NDJSON = () =>
    new Response(exported, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  const fake = fakeTransport({ [`GET ${AUDIT}/export`]: NDJSON });
  const { gateway } = fake.transport;
  const bare = await exportAuditEvents(gateway, 'acme', new URLSearchParams());
  expect(bare).toMatchObject({
    ok: true,
    data: { text: exported, contentType: 'application/x-ndjson; charset=utf-8' },
  });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${AUDIT}/export` });
  expect(fake.sent.at(-1)?.search.toString()).toBe('');
  await exportAuditEvents(gateway, 'acme', new URLSearchParams({ action: 'subject.amend' }));
  expect(fake.sent.at(-1)).toMatchObject({ method: 'GET', path: `${AUDIT}/export` });
  expect(fake.sent.at(-1)?.search.toString()).toBe('action=subject.amend');
});
