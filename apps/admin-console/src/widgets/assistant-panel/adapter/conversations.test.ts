import { describe, expect, it } from 'vitest';
import {
  createConversation,
  deleteConversation,
  exportConversation,
  lastConversation,
  listConversations,
  loadConversation,
  setConversationArchived,
  setConversationMode,
  stopConversation,
} from '#/widgets/assistant-panel/adapter/conversations';
import { fakeTransport, json, problem } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const CONVERSATIONS = `${ACME_ADMIN}/assistant/conversations`;
const CONVERSATION = {
  id: 'c1',
  profile: 'free-chat',
  mode: 'ask',
  title: null,
  created_at: '2026-11-26T08:00:00.000Z',
  last_active_at: '2026-11-26T08:00:00.000Z',
  messages: [],
};

it('starts a conversation on the page the person is on, and reads what the server holds', async () => {
  const fake = fakeTransport({
    [`POST ${CONVERSATIONS}`]: json(CONVERSATION, 201),
    [`GET ${CONVERSATIONS}/c1`]: json(CONVERSATION),
  });
  const { gateway } = fake.transport;

  const created = await createConversation(gateway, 'acme', {
    profile: 'free-chat',
    mode: 'ask',
    page_context: { route: '/clients/c1', objectType: 'client', objectId: 'c1' },
  });
  expect(created).toMatchObject({ ok: true, data: { id: 'c1' } });
  expect(fake.sent[0]?.body).toEqual({
    profile: 'free-chat',
    mode: 'ask',
    page_context: { route: '/clients/c1', objectType: 'client', objectId: 'c1' },
  });

  expect(await loadConversation(gateway, 'acme', 'c1')).toMatchObject({ ok: true });
});

it('refuses a conversation that does not follow the contract', async () => {
  const fake = fakeTransport({ [`GET ${CONVERSATIONS}/c1`]: json({ id: 'c1' }) });
  expect((await loadConversation(fake.transport.gateway, 'acme', 'c1')).ok).toBe(false);
});

it('stops a turn and answers whether one was running', async () => {
  const fake = fakeTransport({ [`POST ${CONVERSATIONS}/c1/stop`]: json({ stopped: true }) });
  expect(await stopConversation(fake.transport.gateway, 'acme', 'c1')).toMatchObject({
    ok: true,
    data: { stopped: true },
  });
  expect(fake.sent[0]?.method).toBe('POST');
});

it('switches the mode with a write the server can refuse', async () => {
  const fake = fakeTransport({
    [`PUT ${CONVERSATIONS}/c1/mode`]: json({ mode: 'act' }),
    [`PUT ${CONVERSATIONS}/c2/mode`]: problem(409),
  });
  const { gateway } = fake.transport;
  expect(await setConversationMode(gateway, 'acme', 'c1', 'act')).toMatchObject({
    ok: true,
    data: { mode: 'act' },
  });
  expect(fake.sent[0]?.body).toEqual({ mode: 'act' });
  expect(await setConversationMode(gateway, 'acme', 'c2', 'act')).toMatchObject({
    ok: false,
    problem: { status: 409 },
  });
});

it('encodes a conversation id as one path segment', async () => {
  const fake = fakeTransport({});
  await loadConversation(fake.transport.gateway, 'acme', '../x');
  expect(fake.calls[0]?.path).toBe(`${CONVERSATIONS}/..%2Fx`);
});

const SUMMARY = {
  id: 'c1',
  title: 'How many clients',
  profile: 'free-chat',
  mode: 'ask',
  created_at: '2026-11-26T08:00:00.000Z',
  last_active_at: '2026-11-26T09:00:00.000Z',
  archived: false,
  archived_at: null,
  reported: false,
  target_tenant_id: null,
};

describe('conversation management', () => {
  it('lists the open ones by default and the archived ones when asked, a page at a time', async () => {
    const fake = fakeTransport({
      [`GET ${CONVERSATIONS}`]: json({ items: [SUMMARY], next: 'n1' }),
    });
    const { gateway } = fake.transport;
    const open = await listConversations(gateway, 'acme', new URLSearchParams({ limit: '25' }));
    expect(open).toMatchObject({ ok: true, data: { items: [{ id: 'c1' }], next: 'n1' } });
    await listConversations(
      gateway,
      'acme',
      new URLSearchParams({ archived: 'true', cursor: 'n1' }),
    );
    expect(fake.sent.map((request) => request.search.toString())).toEqual([
      'limit=25',
      'archived=true&cursor=n1',
    ]);
  });

  it('reads the last conversation, which may be none', async () => {
    const fake = fakeTransport({
      [`GET ${ACME_ADMIN}/assistant/last-conversation`]: json({
        conversation: { ...CONVERSATION, archived: false, continuable: false },
      }),
    });
    expect(await lastConversation(fake.transport.gateway, 'acme')).toMatchObject({
      ok: true,
      data: { conversation: { id: 'c1', continuable: false } },
    });
    const none = fakeTransport({
      [`GET ${ACME_ADMIN}/assistant/last-conversation`]: json({ conversation: null }),
    });
    expect(await lastConversation(none.transport.gateway, 'acme')).toMatchObject({
      ok: true,
      data: { conversation: null },
    });
  });

  it('archives and restores with one route, and says when it was archived', async () => {
    const fake = fakeTransport({
      [`PUT ${CONVERSATIONS}/c1/archived`]: json({
        archived: true,
        archived_at: '2026-11-26T10:00:00.000Z',
      }),
    });
    const { gateway } = fake.transport;
    expect(await setConversationArchived(gateway, 'acme', 'c1', true)).toMatchObject({
      ok: true,
      data: { archived: true },
    });
    expect(fake.sent[0]?.body).toEqual({ archived: true });
  });

  it('deletes, and answers the server’s reason when it holds the conversation', async () => {
    const fake = fakeTransport({
      [`DELETE ${CONVERSATIONS}/c1`]: () => new Response(null, { status: 204 }),
      [`DELETE ${CONVERSATIONS}/c2`]: problem(409, 'about:blank#conversation-reported'),
    });
    const { gateway } = fake.transport;
    expect(await deleteConversation(gateway, 'acme', 'c1')).toMatchObject({ ok: true });
    expect(await deleteConversation(gateway, 'acme', 'c2')).toMatchObject({
      ok: false,
      problem: { status: 409, type: 'about:blank#conversation-reported' },
    });
  });

  it('exports as Markdown or JSON, handed over as the server wrote it', async () => {
    const fake = fakeTransport({
      [`GET ${CONVERSATIONS}/c1/export/markdown`]: () =>
        new Response('# Title', { headers: { 'content-type': 'text/markdown; charset=utf-8' } }),
      [`GET ${CONVERSATIONS}/c1/export`]: json({ exported_at: 'x' }),
    });
    const { gateway } = fake.transport;
    expect(await exportConversation(gateway, 'acme', 'c1', 'markdown')).toMatchObject({
      ok: true,
      data: { text: '# Title', contentType: 'text/markdown; charset=utf-8' },
    });
    expect(await exportConversation(gateway, 'acme', 'c1', 'json')).toMatchObject({ ok: true });
    expect(fake.calls.map((call) => call.path)).toEqual([
      `${CONVERSATIONS}/c1/export/markdown`,
      `${CONVERSATIONS}/c1/export`,
    ]);
  });
});
