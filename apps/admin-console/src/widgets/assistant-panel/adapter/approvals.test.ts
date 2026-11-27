import { expect, it } from 'vitest';
import { decideApproval, listApprovals } from '#/widgets/assistant-panel/adapter/approvals';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const APPROVALS = `${ACME_ADMIN}/assistant/conversations/c1/approvals`;
const CARD = {
  approval_id: 'a1',
  tool_call_id: 'call-1',
  tool: 'create_group',
  title: 'Create a group',
  target: { type: 'group', name: 'ops' },
  before: null,
  after: { name: 'ops' },
  expires_at: '2026-11-26T05:45:00.000Z',
};

it('reads the waiting changes and how far the server’s clock is from the browser’s', async () => {
  const fake = fakeTransport({
    [`GET ${APPROVALS}`]: json({ items: [CARD] }, 200, {
      date: 'Thu, 26 Nov 2026 05:40:00 GMT',
    }),
  });
  const result = await listApprovals(fake.transport.gateway, 'acme', 'c1', () =>
    Date.parse('2026-11-26T05:39:00Z'),
  );
  expect(result).toMatchObject({ ok: true, data: { items: [CARD], offsetMs: 60_999 } });
});

it('treats a list that is not the contract’s as a defect, and passes a refusal on', async () => {
  const wrong = fakeTransport({ [`GET ${APPROVALS}`]: json({ items: [{ approval_id: 1 }] }) });
  expect(await listApprovals(wrong.transport.gateway, 'acme', 'c1')).toEqual({
    ok: false,
    kind: 'schema',
  });
  const refused = fakeTransport({ [`GET ${APPROVALS}`]: problem(404) });
  expect(await listApprovals(refused.transport.gateway, 'acme', 'c1')).toMatchObject({
    ok: false,
    kind: 'problem',
  });
});

it('sends the decision to the change it is for, and answers what the server decided', async () => {
  const fake = fakeTransport({
    [`POST ${APPROVALS}/a1`]: json({ state: 'denied' }),
  });
  const result = await decideApproval(fake.transport.gateway, 'acme', 'c1', 'a1', false);
  expect(result).toMatchObject({ ok: true, data: { state: 'denied' } });
  expect(fake.sent.at(-1)).toMatchObject({ method: 'POST', body: { approve: false } });
});
