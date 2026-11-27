import { expect, it } from 'vitest';
import {
  exportCase,
  readActivityPage,
  readReplay,
  reportConversation,
} from '#/pages/assistant-activity/adapter/assistantActivity';
import {
  ACTIVITY,
  CONVERSATION_ID,
  FIRST,
  PROMPTFOO,
  REPLAY,
  REPORT,
  replay,
} from '#/testing/assistantActivityFixtures';
import { fakeTransport, json } from '#/testing/fakeTransport';

it('reads a page of conversations with the filters and cursor it is given, naming the tool and the outcome', async () => {
  const fake = fakeTransport({ [`GET ${ACTIVITY}`]: json({ items: [FIRST], next: 'c2' }) });
  const query = new URLSearchParams({ tool: 'list_clients', outcome: 'error', cursor: 'c1' });
  const result = await readActivityPage(fake.transport.gateway, 'acme', query);
  expect(result.ok && result.data.next).toBe('c2');
  expect(result.ok && result.data.items[0]).toMatchObject({
    id: CONVERSATION_ID,
    personName: 'ada',
    stopReason: 'done',
    tokens: { fast: 100, standard: 2400, deep: 0 },
    tools: ['list_clients', 'get_client'],
    reportedAt: null,
  });
  expect(fake.sent[0]?.search.toString()).toBe('tool=list_clients&outcome=error&cursor=c1');
});

it('maps a replay to the page’s own shape, steps and events as the server ordered them', async () => {
  const fake = fakeTransport({ [`GET ${REPLAY}`]: json(replay()) });
  const result = await readReplay(fake.transport.gateway, 'acme', CONVERSATION_ID);
  const data = result.ok ? result.data : undefined;
  expect(data?.textVisible).toBe(true);
  expect(data?.turns[0]?.steps.map((s) => [s.id, s.inputTokens, s.outputTokens])).toEqual([
    ['step-1', 1200, 80],
    ['step-2', 1500, 300],
  ]);
  expect(data?.turns[0]?.events.map((e) => [e.seq, e.stepId, e.kind])).toEqual([
    [0, null, 'slot_chosen'],
    [1, 'step-1', 'tool_call'],
    [2, 'step-1', 'tool_result'],
    [3, 'step-2', 'text'],
  ]);
  expect(data?.approvals[0]).toMatchObject({ tool: 'delete_client', state: 'denied' });
});

it('refuses a replay whose answer does not match the contract', async () => {
  const fake = fakeTransport({ [`GET ${REPLAY}`]: json({ ...replay(), turns: 'none' }) });
  const result = await readReplay(fake.transport.gateway, 'acme', CONVERSATION_ID);
  expect(result).toMatchObject({ ok: false, kind: 'schema' });
});

it('takes the test case as the text the server sent', async () => {
  const fake = fakeTransport({
    [`GET ${PROMPTFOO}`]: () =>
      new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }),
  });
  const result = await exportCase(fake.transport.gateway, 'acme', CONVERSATION_ID);
  expect(result).toMatchObject({
    ok: true,
    data: { text: '{"a":1}', contentType: 'application/json' },
  });
});

it('reports a conversation with a POST and reads what the tenant keeps', async () => {
  const fake = fakeTransport({
    [`POST ${REPORT}`]: json({
      reported_at: '2026-11-25T09:00:00.000Z',
      reported_count: 81,
      near_limit: true,
    }),
  });
  const result = await reportConversation(fake.transport.gateway, 'acme', CONVERSATION_ID);
  expect(result).toMatchObject({
    ok: true,
    data: { reportedAt: '2026-11-25T09:00:00.000Z', reportedCount: 81, nearLimit: true },
  });
  expect(fake.sent[0]?.method).toBe('POST');
});
