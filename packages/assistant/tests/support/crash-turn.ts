// Run by budget-crash.int.test.ts as a separate node process, which kills it
// while a model call is in flight. It writes SENT when the call reaches the
// model and never answers it, or DONE with the turn's stop reason when a
// limit ended the turn first.
import { createDatabase, withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { TOOLS } from '@odudu/mcp';
import { MockLanguageModelV3 } from 'ai/test';
import { createChat } from '#/view/chat-route';

const url = process.env.CRASH_DATABASE_URL ?? '';
const tenantId = process.env.CRASH_TENANT ?? '';
const subjectId = process.env.CRASH_SUBJECT ?? '';

const app = createDatabase(url, { max: 4 });

const model = new MockLanguageModelV3({
  doStream: () => {
    process.stdout.write('SENT\n');
    return new Promise(() => undefined);
  },
});

const chat = createChat({
  transact: (tenant, fn) => withTenant(app.db, tenant, fn),
  model: () => model,
  tools: TOOLS,
  turn: () => ({
    mintToken: () => Promise.resolve({ accessToken: 'token' }),
    callTool: () => Promise.reject(new Error('no tools in this run')),
  }),
  instanceIdFor: () => newId(),
  withAccess: (access, _conversation, fn) =>
    withTenant(app.db, access.tenantId, async (tx) => ({
      kind: 'granted' as const,
      value: await fn(tx),
    })),
  now: () => new Date(),
  newId,
});

const caller = {
  tenantId,
  ownerSubjectId: subjectId,
  tenantName: 'acme',
  issuer: 'https://id.example/acme',
  grantId: newId(),
  requestId: 'crash',
  ip: '127.0.0.1',
};

const created = await chat.create(caller, {
  profile: 'free-chat',
  mode: 'ask',
  page_context: { route: '/clients', objectType: 'client', objectId: 'web' },
});
if (created.kind !== 'created') throw new Error('the conversation was not created');

const sent = await chat.send(
  caller,
  created.conversation.id,
  { id: newId(), role: 'user', parts: [{ type: 'text', text: 'hello' }] },
  new AbortController().signal,
);
if (sent.kind !== 'stream') {
  process.stdout.write(`REFUSED ${sent.kind}\n`);
} else {
  const body = await sent.response.text();
  const reason = /"stopReason":"([a-z_]+)"/u.exec(body)?.[1] ?? 'none';
  process.stdout.write(`DONE ${reason}\n`);
}
await app.close();
