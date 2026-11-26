import { expect, it } from 'vitest';
import {
  createConversation,
  readAssistantStatus,
  readConversation,
} from '#/entities/assistant/adapter/assistant';
import { fakeTransport, json } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

const STATUS = `${ACME_ADMIN}/assistant/status`;
const CONVERSATIONS = `${ACME_ADMIN}/assistant/conversations`;
const ENABLED = {
  enabled: true,
  slots: { fast: 'model-f', standard: 'model-s', deep: 'model-d' },
  modes: ['ask'],
  defaultMode: 'ask',
  modelChoices: ['model-s'],
  provider: { kind: 'anthropic' },
};
const CONVERSATION = {
  id: 'c1',
  profile: 'free',
  mode: 'ask',
  title: null,
  created_at: '2026-11-26T10:00:00.000Z',
  last_active_at: '2026-11-26T10:00:00.000Z',
  messages: [],
};

it('reads the status of an assistant that is on, and one that is off', async () => {
  const on = fakeTransport({ [`GET ${STATUS}`]: json(ENABLED) });
  expect(await readAssistantStatus(on.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: ENABLED,
  });
  const off = fakeTransport({ [`GET ${STATUS}`]: json({ enabled: false }) });
  expect(await readAssistantStatus(off.transport.gateway, 'acme')).toMatchObject({
    ok: true,
    data: { enabled: false },
  });
});

it('refuses a status that does not follow the contract', async () => {
  const fake = fakeTransport({ [`GET ${STATUS}`]: json({ enabled: true }) });
  expect((await readAssistantStatus(fake.transport.gateway, 'acme')).ok).toBe(false);
});

it('starts a conversation with the page it began on, and reads it back', async () => {
  const fake = fakeTransport({
    [`POST ${CONVERSATIONS}`]: json(CONVERSATION, 201),
    [`GET ${CONVERSATIONS}/c1`]: json(CONVERSATION),
  });
  const request = { page_context: { route: '/console/acme/subjects', objectType: 'subject' } };
  expect(await createConversation(fake.transport.gateway, 'acme', request)).toMatchObject({
    ok: true,
    data: { id: 'c1' },
  });
  expect(fake.sent[0]).toMatchObject({ method: 'POST', path: CONVERSATIONS, body: request });
  expect(await readConversation(fake.transport.gateway, 'acme', 'c1')).toMatchObject({
    ok: true,
    data: { id: 'c1', messages: [] },
  });
});

it('writes a conversation id as one path segment', async () => {
  const fake = fakeTransport({});
  await readConversation(fake.transport.gateway, 'acme', 'a/b');
  expect(fake.sent[0]?.path).toBe(`${CONVERSATIONS}/a%2Fb`);
});
