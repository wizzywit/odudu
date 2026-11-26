import { expect, it } from 'vitest';
import {
  createConversation,
  loadConversation,
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
