import { createHash } from 'node:crypto';
import { TOOLS, type ToolResult } from '@odudu/mcp';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { messageRepository } from '#/repository/messages';
import type { AssistantLimits } from '#/service/limits';
import { runKey, RunLapsed } from '#/service/run-key';
import type { TurnStart, TurnSummary } from '#/service/turn-summary';
import { createChat, type Chat, type ChatCaller, type ChatDeps } from '#/view/chat-route';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 8 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

type Part = Record<string, unknown>;

function toolCalls(...calls: [string, string, string][]): Part[] {
  return [
    ...calls.map(([id, name, input]) => ({
      type: 'tool-call',
      toolCallId: id,
      toolName: name,
      input,
    })),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
  ];
}

function answer(text: string): Part[] {
  return [
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: text },
    { type: 'text-end', id: 'a' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ];
}

// One scripted reply per model call, in order; `seen` records each call's
// prompt and abort signal.
interface Seen {
  prompt: unknown;
  signal: AbortSignal | undefined;
}

function scripted(replies: (Part[] | 'hang')[], seen: Seen[] = []): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: (options) => {
      const reply = replies[Math.min(call, replies.length - 1)] ?? [];
      call += 1;
      seen.push({ prompt: options.prompt, signal: options.abortSignal });
      if (reply === 'hang') {
        // Some text, then nothing until the call is aborted.
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 'h' });
              controller.enqueue({ type: 'text-delta', id: 'h', delta: 'partial' });
              options.abortSignal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
              });
            },
          }) as never,
        });
      }
      return Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...reply,
        ] as never),
      });
    },
  });
}

const CLIENTS: ToolResult = {
  isError: false,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { data: [{ client_id: 'web' }] },
};

interface World {
  tenantId: string;
  alice: string;
  bob: string;
}

async function world(): Promise<World> {
  const tenantId = newId();
  const alice = newId();
  const bob = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `chat-${tenantId.slice(-12)}` });
    for (const id of [alice, bob]) {
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')`,
      );
    }
  });
  return { tenantId, alice, bob };
}

function callerOf(w: World, ownerSubjectId: string): ChatCaller {
  return {
    tenantId: w.tenantId,
    ownerSubjectId,
    tenantName: 'acme',
    issuer: 'https://id.example/acme',
    grantId: newId(),
    requestId: 'req-1',
    ip: '127.0.0.1',
  };
}

function chatOver(
  model: MockLanguageModelV3,
  overrides: Partial<ChatDeps> = {},
): {
  chat: Chat;
  mintToken: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  turns: { started: TurnStart[]; ended: TurnSummary[] };
  turnIds: string[];
} {
  const turns = { started: [] as TurnStart[], ended: [] as TurnSummary[] };
  const turnIds: string[] = [];
  const mintToken = vi.fn(() => Promise.resolve({ accessToken: 'token' }));
  const callTool = vi.fn(() => Promise.resolve(CLIENTS));
  const chat = createChat({
    transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
    model: () => model,
    tools: TOOLS,
    turn: (_caller, _conversation, turnId) => {
      turnIds.push(turnId);
      return { mintToken, callTool };
    },
    recordTurnStart: (start) => {
      turns.started.push(start);
      return Promise.resolve();
    },
    recordTurn: (summary) => {
      turns.ended.push(summary);
      return Promise.resolve();
    },
    instanceIdFor: () => newId(),
    withAccess: (caller, _conversation, fn) =>
      withTenant(app.db, caller.tenantId, async (tx) => ({
        kind: 'granted' as const,
        value: await fn(tx),
      })),
    now: () => new Date(),
    newId,
    ...overrides,
  });
  return { chat, mintToken, callTool, turns, turnIds };
}

// A stable uuid for each run key, as the server derives one.
function runInstanceOf(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const OPEN_LIMITS: AssistantLimits = {
  monthlyTokensBySlot: { fast: 1_000_000, standard: 1_000_000, deep: 1_000_000 },
  allowedModels: [],
  toolClasses: ['read', 'write'],
  modes: ['ask', 'act'],
  maxConcurrent: 4,
  maxStepsPerTurn: 8,
};

const CONTEXT = { route: '/clients', objectType: 'client', objectId: 'web' };

async function started(chat: Chat, caller: ChatCaller): Promise<string> {
  const created = await chat.create(caller, {
    profile: 'free-chat',
    mode: 'ask',
    page_context: CONTEXT,
  });
  if (created.kind !== 'created') throw new Error(`not created: ${created.kind}`);
  return created.conversation.id;
}

function say(text: string, id = newId()) {
  return { id, role: 'user' as const, parts: [{ type: 'text' as const, text }] };
}

async function streamOf(chat: Chat, caller: ChatCaller, id: string, text: string) {
  const sent = await chat.send(caller, id, say(text), new AbortController().signal);
  if (sent.kind !== 'stream') throw new Error(`not streaming: ${sent.kind}`);
  return sent.response;
}

async function stored(w: World, conversationId: string) {
  return withTenant(app.db, w.tenantId, (tx) => messageRepository(tx).load(conversationId, 100));
}

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the condition never held');
}

describe('create and load', () => {
  it('creates a conversation with its page context and loads it for its owner only', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]));
    const id = await started(chat, callerOf(w, w.alice));

    const loaded = await chat.load(callerOf(w, w.alice), id);
    expect(loaded).toMatchObject({ id, profile: 'free-chat', mode: 'ask', messages: [] });

    expect(await chat.load(callerOf(w, w.bob), id)).toBeNull();
    expect(await chat.load(callerOf(w, w.alice), newId())).toBeNull();
  });

  it('refuses a profile this server does not know', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]));
    const created = await chat.create(callerOf(w, w.alice), {
      profile: 'nonesuch',
      mode: 'ask',
      page_context: CONTEXT,
    });
    expect(created.kind).toBe('unknown_profile');
  });

  it('starts a read profile in Ask, and refuses Act for it', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]));
    const caller = callerOf(w, w.alice);
    const created = await chat.create(caller, {
      profile: 'why-cant-sign-in',
      page_context: { route: '/subjects/a', objectType: 'subject', objectId: 'a' },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    expect(created.conversation).toMatchObject({ profile: 'why-cant-sign-in', mode: 'ask' });
    expect(
      await chat.create(caller, { profile: 'review-client', mode: 'act', page_context: CONTEXT }),
    ).toEqual({ kind: 'access_refused', reason: 'profile_mode_refused' });
  });

  it('refuses Act in a tenant whose modes lack it, and writes nothing', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]), {
      entitlements: {
        limits: () => Promise.resolve({ ...OPEN_LIMITS, modes: ['ask'] }),
      },
    });
    const created = await chat.create(callerOf(w, w.alice), {
      mode: 'act',
      page_context: CONTEXT,
    });
    expect(created).toEqual({ kind: 'access_refused', reason: 'mode_not_offered' });
    const rows = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from assistant_conversations`),
    );
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  it('asks for the conversation’s grant in the transaction that creates it, naming its id and mode', async () => {
    const w = await world();
    const seen: { id: string; mode: string }[] = [];
    const { chat } = chatOver(scripted([answer('hi')]), {
      withAccess: (caller, conversation, fn) => {
        seen.push({ id: conversation.id, mode: conversation.mode });
        return withTenant(app.db, caller.tenantId, async (tx) => ({
          kind: 'granted' as const,
          value: await fn(tx),
        }));
      },
    });
    const caller = callerOf(w, w.alice);
    const created = await chat.create(caller, { mode: 'act', page_context: CONTEXT });
    if (created.kind !== 'created') throw new Error(created.kind);
    expect(seen).toEqual([{ id: created.conversation.id, mode: 'act' }]);
  });

  it('writes no conversation when the grant is refused', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]), {
      withAccess: () => Promise.resolve({ kind: 'refused', reason: 'grant_not_console' }),
    });
    const created = await chat.create(callerOf(w, w.alice), {
      mode: 'ask',
      page_context: CONTEXT,
    });
    expect(created).toEqual({ kind: 'access_refused', reason: 'grant_not_console' });
    const rows = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from assistant_conversations`),
    );
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  it('writes no conversation when making the grant fails part way', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi')]), {
      // The conversation is written, then the grant fails: both roll back.
      withAccess: (caller, _conversation, fn) =>
        withTenant(app.db, caller.tenantId, async (tx) => {
          await fn(tx);
          throw new Error('the grant could not be made');
        }),
    });
    await expect(
      chat.create(callerOf(w, w.alice), { mode: 'ask', page_context: CONTEXT }),
    ).rejects.toThrow('the grant could not be made');
    const rows = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from assistant_conversations`),
    );
    expect((rows as unknown as { n: number }[])[0]?.n).toBe(0);
  });
});

describe('a conversation whose instance lapsed', () => {
  async function row(w: World, id: string) {
    const rows = (await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(
        sql`select run_generation, instance_id from assistant_conversations where id = ${id}`,
      ),
    )) as unknown as { run_generation: number; instance_id: string }[];
    return rows[0];
  }

  it('starts on run 0 and, on a lapse, moves to run 1 once and carries on', async () => {
    const w = await world();
    const keys: string[] = [];
    let lapsed = false;
    const mintToken = vi.fn((run: { key: string }) => {
      keys.push(run.key);
      if (!lapsed) {
        lapsed = true;
        return Promise.reject(new RunLapsed());
      }
      return Promise.resolve({ accessToken: 'token' });
    });
    const { chat, callTool } = chatOver(
      scripted([toolCalls(['c1', 'list_clients', '{}']), answer('Back again.')]),
      {
        turn: () => ({ mintToken, callTool: () => Promise.resolve(CLIENTS) }),
        instanceIdFor: (_caller, _id, key) => runInstanceOf(key),
      },
    );
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    expect((await row(w, id))?.run_generation).toBe(0);
    await (await streamOf(chat, caller, id, 'how many?')).text();
    expect(keys).toEqual([runKey(id, 0), runKey(id, 1)]);
    expect(await row(w, id)).toEqual({
      run_generation: 1,
      instance_id: runInstanceOf(runKey(id, 1)),
    });
    expect(callTool).toBeDefined();
  });

  it('does not move on for another refusal', async () => {
    const w = await world();
    const mintToken = vi.fn(() => Promise.reject(new Error('owner_ended')));
    const { chat } = chatOver(
      scripted([toolCalls(['c1', 'list_clients', '{}']), answer('Refused.')]),
      { turn: () => ({ mintToken, callTool: () => Promise.resolve(CLIENTS) }) },
    );
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, 'how many?')).text();
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect((await row(w, id))?.run_generation).toBe(0);
  });

  it('is moved on once when two calls of one step both see it lapse', async () => {
    const w = await world();
    const lapsedKeys = new Set<string>();
    const mintToken = vi.fn((run: { key: string }) => {
      if (run.key.endsWith('.0')) {
        lapsedKeys.add(run.key);
        return Promise.reject(new RunLapsed());
      }
      return Promise.resolve({ accessToken: 'token' });
    });
    const { chat } = chatOver(
      scripted([
        toolCalls(['c1', 'list_clients', '{}'], ['c2', 'list_clients', '{"limit":1}']),
        answer('Both.'),
      ]),
      { turn: () => ({ mintToken, callTool: () => Promise.resolve(CLIENTS) }) },
    );
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, 'two lists')).text();
    expect((await row(w, id))?.run_generation).toBe(1);
  });
});

describe('a turn', () => {
  it('streams the answer and stores both messages', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('You have one client.')]));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);

    const body = await (await streamOf(chat, caller, id, 'how many clients?')).text();
    expect(body).toContain('You have one client.');

    const messages = (await stored(w, id)).filter((m) => m.role !== 'system');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const loaded = await chat.load(caller, id);
    expect(loaded?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('puts the stored page context, and nothing else, in what the model is told', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted([answer('ok')], seen));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, 'hello')).text();
    const prompt = JSON.stringify(seen[0]?.prompt);
    expect(prompt).toContain('/clients');
    expect(prompt).toContain('client web');
  });

  it('stores each step as it ends, so a turn still running has its earlier steps on disk', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([toolCalls(['c1', 'list_clients', '{"limit":3}']), 'hang']));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const response = await streamOf(chat, caller, id, 'list them');
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    // A client reads as the turn writes; the stream is pulled, not pushed.
    const drained = (async () => {
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true }));
        if (chunk.done) return;
      }
    })();

    await until(async () => {
      const assistant = (await stored(w, id)).find((m) => m.role === 'assistant');
      return JSON.stringify(assistant?.parts ?? []).includes('list_clients');
    });
    expect(await chat.stop(caller, id)).toBe('stopped');
    await drained;
  });

  it('shares one run key across the calls of one step', async () => {
    const w = await world();
    const { chat, mintToken } = chatOver(
      scripted([
        toolCalls(['c1', 'list_clients', '{"limit":1}'], ['c2', 'list_clients', '{"limit":2}']),
        answer('done'),
      ]),
    );
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, 'two lists')).text();
    expect(mintToken).toHaveBeenCalledTimes(2);
    for (const call of mintToken.mock.calls) {
      expect((call as unknown[])[0]).toEqual({ key: `${id}.0`, conversationId: id });
    }
  });

  it('is not served to another administrator, nor stopped by one', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('x')]));
    const id = await started(chat, callerOf(w, w.alice));
    const bob = callerOf(w, w.bob);
    expect((await chat.send(bob, id, say('hi'), new AbortController().signal)).kind).toBe(
      'not_found',
    );
    expect(await chat.stop(bob, id)).toBe('not_found');
    expect((await stored(w, id)).filter((m) => m.role === 'user')).toHaveLength(0);
  });

  it('refuses a second message while one is running, and accepts one after it ends', async () => {
    const w = await world();
    const { chat } = chatOver(scripted(['hang', answer('later')]));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const first = await streamOf(chat, caller, id, 'one');
    const reader = first.body?.getReader();
    await reader?.read();
    expect((await chat.send(caller, id, say('two'), new AbortController().signal)).kind).toBe(
      'busy',
    );
    await reader?.cancel();
    await until(async () => {
      const again = await chat.send(caller, id, say('three'), new AbortController().signal);
      if (again.kind !== 'stream') return false;
      await again.response.text();
      return true;
    });
  });
});

describe('the audit rows of a turn', () => {
  const SECRET_WORDS = 'the quarterly payroll for Hadleigh Ltd';

  async function lease(w: World, conversationId: string): Promise<number> {
    const rows = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from assistant_turn_leases where conversation_id = ${conversationId}`,
      ),
    );
    return (rows as unknown as { n: number }[])[0]?.n ?? -1;
  }

  it('opens and closes each turn with one row, holding no message text', async () => {
    const w = await world();
    const { chat, turns, turnIds } = chatOver(scripted([answer('Nothing to report.')]));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, SECRET_WORDS)).text();
    await until(() => Promise.resolve(turns.ended.length === 1));

    expect(turns.started).toHaveLength(1);
    expect(turns.started[0]).toMatchObject({
      tenantId: w.tenantId,
      subjectId: w.alice,
      conversationId: id,
      profile: 'free-chat',
      mode: 'ask',
      slots: ['standard'],
    });
    expect(turns.ended[0]).toMatchObject({
      conversationId: id,
      turnId: turnIds[0],
      steps: 1,
      stopReason: 'done',
      outcome: 'allowed',
      slots: ['standard'],
    });
    expect(turns.ended[0]?.turnId).toBe(turns.started[0]?.turnId);
    expect(turns.ended[0]?.tokensBySlot.standard ?? 0).toBeGreaterThan(0);
    const recorded = JSON.stringify([turns.started, turns.ended]);
    for (const word of SECRET_WORDS.split(' ')) expect(recorded).not.toContain(word);
    expect(recorded).not.toContain('Nothing to report');
  });

  it('closes a turn that was ended by the person, with the reason', async () => {
    const w = await world();
    const { chat, turns } = chatOver(scripted(['hang']));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const reader = (await streamOf(chat, caller, id, 'go')).body?.getReader();
    await reader?.read();
    await chat.stop(caller, id);
    await until(() => Promise.resolve(turns.ended.length === 1));
    expect(turns.ended[0]).toMatchObject({ stopReason: 'aborted', outcome: 'allowed' });
    await reader?.cancel().catch(() => undefined);
  });

  it('closes a turn the model failed, as failed', async () => {
    const w = await world();
    const failing = new MockLanguageModelV3({
      doStream: () => Promise.reject(new Error('provider down')),
    });
    const { chat, turns } = chatOver(failing);
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await (await streamOf(chat, caller, id, 'go')).text().catch(() => undefined);
    await until(() => Promise.resolve(turns.ended.length === 1));
    expect(turns.ended[0]).toMatchObject({ stopReason: 'error', outcome: 'failed' });
  });

  it('does not start the turn when the opening row cannot be written', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const log = vi.fn();
    const { chat, turns } = chatOver(scripted([answer('never')], seen), {
      recordTurnStart: () => Promise.reject(new Error('audit unavailable')),
      log,
    });
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    await expect(
      chat.send(caller, id, say(SECRET_WORDS), new AbortController().signal),
    ).rejects.toThrow('audit unavailable');

    expect(seen).toHaveLength(0);
    expect(turns.ended).toHaveLength(0);
    expect((await stored(w, id)).filter((m) => m.role !== 'system')).toEqual([]);
    expect(await lease(w, id)).toBe(0);
    const reservations = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from assistant_reservations`),
    );
    expect((reservations as unknown as { n: number }[])[0]?.n).toBe(0);
    // The place is given back, so the conversation takes a turn once the audit works again.
    const retry = chatOver(scripted([answer('now')]));
    expect(await (await streamOf(retry.chat, caller, id, 'again')).text()).toContain('now');
  });

  it('keeps the person’s answer when the closing row cannot be written, and says so in the log', async () => {
    const w = await world();
    const log = vi.fn();
    const { chat } = chatOver(scripted([answer('Still here.')]), {
      recordTurn: () => Promise.reject(new Error('audit unavailable')),
      log,
    });
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    expect(await (await streamOf(chat, caller, id, 'go')).text()).toContain('Still here.');
    await until(() =>
      Promise.resolve(log.mock.calls.some(([e]) => e === 'assistant.turn_audit_failed')),
    );
    expect(await lease(w, id)).toBe(0);
  });
});

describe('ending a turn', () => {
  it('aborts the model call and settles the turn when the response is closed', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted(['hang', answer('after')], seen));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const response = await streamOf(chat, caller, id, 'go');
    const reader = response.body?.getReader();
    await until(() => Promise.resolve(seen.length > 0));
    expect(seen[0]?.signal?.aborted).toBe(false);

    await reader?.cancel();
    await until(() => Promise.resolve(seen[0]?.signal?.aborted === true));

    // Settled: the partial answer is stored and the conversation takes the next message.
    await until(async () => {
      const assistant = (await stored(w, id)).find((m) => m.role === 'assistant');
      return JSON.stringify(assistant?.parts ?? []).includes('partial');
    });
    // The turn gives its place back once the budget is settled and the lease released,
    // which follows the stored answer, so the next message is refused as busy until then.
    let next = await chat.send(caller, id, say('again'), new AbortController().signal);
    for (let attempt = 0; attempt < 100 && next.kind === 'busy'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      next = await chat.send(caller, id, say('again'), new AbortController().signal);
    }
    expect(next.kind).toBe('stream');
    if (next.kind === 'stream') await next.response.text();
  });

  it('aborts the model call when the request signal fires', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted(['hang'], seen));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const request = new AbortController();
    const sent = await chat.send(caller, id, say('go'), request.signal);
    expect(sent.kind).toBe('stream');
    const reader = sent.kind === 'stream' ? sent.response.body?.getReader() : undefined;
    await reader?.read();
    request.abort();
    await until(() => Promise.resolve(seen[0]?.signal?.aborted === true));
    await reader?.cancel().catch(() => undefined);
  });

  it('stop ends a running turn and the stream finishes', async () => {
    const w = await world();
    const { chat } = chatOver(scripted(['hang']));
    const caller = callerOf(w, w.alice);
    const id = await started(chat, caller);
    const response = await streamOf(chat, caller, id, 'go');
    const reader = response.body?.getReader();
    await reader?.read();
    expect(await chat.stop(caller, id)).toBe('stopped');
    let done = false;
    while (!done) {
      const chunk = await reader?.read().catch(() => ({ done: true }));
      done = chunk?.done ?? true;
    }
    expect(await chat.stop(caller, id)).toBe('idle');
  });
});

describe('a turn ended while a tool call is pending', () => {
  it('leaves a conversation that takes the next message', async () => {
    const w = await world();
    const caller = callerOf(w, w.alice);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { chat } = chatOver(
      scripted([toolCalls(['c1', 'list_clients', '{"limit":3}']), answer('Back again.')]),
      {
        // A token that is slow to come and ignores the abort, as a mint may.
        turn: () => ({
          mintToken: async () => {
            await held;
            return { accessToken: 'token' };
          },
          callTool: () => Promise.resolve(CLIENTS),
        }),
      },
    );
    const id = await started(chat, caller);
    const first = await streamOf(chat, caller, id, 'list them');
    const reader = first.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    const drained = (async () => {
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true }));
        if (chunk.done) return;
      }
    })();
    // Wait until the model's call to the tool has been streamed, then stop.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await chat.stop(caller, id)).toBe('stopped');
    release();
    await drained;

    await until(async () => {
      const again = await chat.send(caller, id, say('and now?'), new AbortController().signal);
      if (again.kind !== 'stream') return false;
      expect(await again.response.text()).toContain('Back again.');
      return true;
    });
  });
});

describe('a turn that outlasts its deadline', () => {
  it('is aborted, and the conversation takes the next message', async () => {
    const w = await world();
    const caller = callerOf(w, w.alice);
    const seen: Seen[] = [];
    const events: string[] = [];
    const { chat } = chatOver(scripted(['hang', answer('Later.')], seen), {
      turnDeadlineMs: 150,
      log: (event) => {
        events.push(event);
      },
    });
    const id = await started(chat, caller);
    const first = await streamOf(chat, caller, id, 'stall');
    const reader = first.body?.getReader();
    const drained = (async () => {
      for (;;) {
        const chunk = await reader?.read().catch(() => ({ done: true }));
        if (chunk?.done ?? true) return;
      }
    })();
    await until(() => Promise.resolve(seen[0]?.signal?.aborted === true));
    await drained;
    expect(events).toContain('assistant.turn_deadline');
    await until(async () => {
      const again = await chat.send(caller, id, say('again'), new AbortController().signal);
      if (again.kind !== 'stream') return false;
      await again.response.text();
      return true;
    });
  });
});

describe('a second server instance', () => {
  it('resumes a conversation from its stored messages', async () => {
    const w = await world();
    const caller = callerOf(w, w.alice);
    const first = chatOver(scripted([answer('Blue is the colour.')]));
    const id = await started(first.chat, caller);
    await (await streamOf(first.chat, caller, id, 'what colour is it?')).text();

    const seen: Seen[] = [];
    const second = chatOver(scripted([answer('As I said.')], seen));
    await (await streamOf(second.chat, caller, id, 'and again?')).text();

    const prompt = JSON.stringify(seen[0]?.prompt);
    expect(prompt).toContain('what colour is it?');
    expect(prompt).toContain('Blue is the colour.');
    expect(prompt).toContain('and again?');
    expect((await stored(w, id)).filter((m) => m.role !== 'system')).toHaveLength(4);
  });
});

describe('two server instances on one conversation', () => {
  it('lose neither turn’s messages when their turns overlap', async () => {
    const w = await world();
    const caller = callerOf(w, w.alice);
    const a = chatOver(scripted([toolCalls(['c1', 'list_clients', '{"limit":3}']), 'hang']));
    const b = chatOver(scripted([answer('From the second server.')]));
    const id = await started(a.chat, caller);

    const first = await streamOf(a.chat, caller, id, 'first question');
    const reader = first.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    const drained = (async () => {
      for (;;) {
        const chunk = await reader.read().catch(() => ({ done: true }));
        if (chunk.done) return;
      }
    })();
    await until(async () => {
      const assistant = (await stored(w, id)).find((m) => m.role === 'assistant');
      return JSON.stringify(assistant?.parts ?? []).includes('list_clients');
    });

    // The second server's registry knows nothing of the first's turn.
    await (await streamOf(b.chat, caller, id, 'second question')).text();
    expect(await a.chat.stop(caller, id)).toBe('stopped');
    await drained;

    const messages = (await stored(w, id)).filter((m) => m.role !== 'system');
    const text = JSON.stringify(messages.map((m) => m.parts));
    expect(text).toContain('first question');
    expect(text).toContain('second question');
    expect(text).toContain('From the second server.');
  });
});
