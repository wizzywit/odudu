import { describe, expect, it } from 'vitest';
import {
  createConversationHandler,
  setConversationModeHandler,
  type AssistantChatPort,
} from '#/view/routes/assistant';

// What a refusal to offer Act says, which the console matches by sentence.
const TARGET = 'the tenant this conversation acts in does not offer Act';
const SYSTEM = '0199aa00-0000-7000-8000-000000000001';

interface Sent {
  status: number;
  body: { detail?: string };
}

function fakeReply(sent: Sent[]) {
  const reply = {
    status: 200,
    code(status: number) {
      reply.status = status;
      return reply;
    },
    header: () => reply,
    send(body: Sent['body']) {
      sent.push({ status: reply.status, body });
      return reply;
    },
  };
  return reply;
}

const request = {
  id: 'r1',
  ip: '127.0.0.1',
  protocol: 'https',
  host: 'id.example.com',
  params: { tenant: 'demo', id: 'c1' },
  body: { mode: 'act', page_context: { route: '/x' } },
};
const principal = {
  subjectId: 's1',
  grantId: 'g1',
  issuerTenantId: SYSTEM,
  issuerTenantName: 'system',
};

async function run(chat: Partial<AssistantChatPort>, handler: 'mode' | 'create'): Promise<Sent> {
  const sent: Sent[] = [];
  const deps = { chat: chat as AssistantChatPort, cursorKey: new Uint8Array(32) };
  const make = handler === 'mode' ? setConversationModeHandler : createConversationHandler;
  await make(deps)(
    request as never,
    fakeReply(sent) as never,
    principal as never,
    '0199aa00-0000-7000-8000-0000000000aa',
  );
  return sent[0] ?? { status: 0, body: {} };
}

describe('the refusal to switch a conversation to Act', () => {
  it('says the other tenant is the cause when it does not offer Act', async () => {
    const sent = await run(
      { setMode: () => Promise.resolve({ kind: 'not_offered', cause: 'target' }) },
      'mode',
    );
    expect(sent).toMatchObject({ status: 409, body: { detail: TARGET } });
  });

  it('keeps the plain sentence for a mode the caller’s own tenant does not offer', async () => {
    const sent = await run({ setMode: () => Promise.resolve({ kind: 'not_offered' }) }, 'mode');
    expect(sent).toMatchObject({
      status: 409,
      body: { detail: 'this mode is not offered here' },
    });
  });

  it('is the same 409 when a conversation is started in Act in such a tenant', async () => {
    const sent = await run(
      {
        create: () => Promise.resolve({ kind: 'access_refused', reason: 'target_act_not_offered' }),
      },
      'create',
    );
    expect(sent).toMatchObject({ status: 409, body: { detail: TARGET } });
  });

  it('stays 403 for any other refusal of an identity', async () => {
    const sent = await run(
      { create: () => Promise.resolve({ kind: 'access_refused', reason: 'grant_revoked' }) },
      'create',
    );
    expect(sent.status).toBe(403);
  });
});
