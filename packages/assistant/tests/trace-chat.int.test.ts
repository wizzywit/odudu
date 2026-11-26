import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { TOOLS, type ToolResult } from '@odudu/mcp';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type Telemetry } from 'ai';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assistantTools } from '#/service/tool-set';
import type { TurnSummary } from '#/service/turn-summary';
import { writeSettings } from '#/usecase/settings';
import { createChat, type Chat, type ChatCaller } from '#/view/chat-route';

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
  inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

type Part = Record<string, unknown>;

const toolCall = (id: string, name: string, input: unknown): Part[] => [
  { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
];

const answer = (text: string): Part[] => [
  { type: 'text-start', id: 'a' },
  { type: 'text-delta', id: 'a', delta: text },
  { type: 'text-end', id: 'a' },
  { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
];

interface Seen {
  prompt: unknown;
  tools: string[];
}

function scripted(replies: (Part[] | Error)[], seen: Seen[] = []): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    provider: 'mock-provider',
    modelId: 'mock-model',
    doStream: (options) => {
      const reply = replies[Math.min(call, replies.length - 1)] ?? [];
      call += 1;
      seen.push({
        prompt: options.prompt,
        tools: (options.tools ?? []).map((entry) => entry.name),
      });
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...reply,
        ] as never),
      });
    },
  });
}

const result = (data: unknown): ToolResult => ({
  isError: false,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { data },
});

interface World {
  tenantId: string;
  alice: string;
}

async function world(maskEmails = false): Promise<World> {
  const tenantId = newId();
  const alice = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tc-${tenantId.slice(-12)}` });
    await tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${alice}, ${tenantId}, 'user')`,
    );
    await writeSettings(
      tx,
      tenantId,
      { ...ASSISTANT_SETTING_DEFAULTS, assistant_mask_emails: maskEmails },
      new Date(),
    );
  });
  return { tenantId, alice };
}

const callerOf = (w: World): ChatCaller => ({
  tenantId: w.tenantId,
  ownerSubjectId: w.alice,
  tenantName: 'acme',
  issuer: 'https://id.example/acme',
  grantId: newId(),
  requestId: 'req-1',
  ip: '127.0.0.1',
});

function chatOver(
  model: MockLanguageModelV3,
  tool: ToolResult,
  extra: { telemetry?: Telemetry[] } = {},
): { chat: Chat; ended: TurnSummary[]; log: ReturnType<typeof vi.fn> } {
  const ended: TurnSummary[] = [];
  const log = vi.fn();
  const chat = createChat({
    transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
    model: () => model,
    tools: TOOLS,
    turn: () => ({
      mintToken: () => Promise.resolve({ accessToken: 'token' }),
      callTool: () => Promise.resolve(tool),
    }),
    recordTurnStart: () => Promise.resolve(),
    recordTurn: (summary) => {
      ended.push(summary);
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
    log,
    ...(extra.telemetry === undefined ? {} : { telemetry: extra.telemetry }),
  });
  return { chat, ended, log };
}

async function turnOf(chat: Chat, caller: ChatCaller, text: string): Promise<string> {
  const created = await chat.create(caller, {
    profile: 'free-chat',
    mode: 'ask',
    page_context: { route: '/clients', objectType: 'client', objectId: 'web' },
  });
  if (created.kind !== 'created') throw new Error(`not created: ${created.kind}`);
  const sent = await chat.send(
    caller,
    created.conversation.id,
    { id: newId(), role: 'user', parts: [{ type: 'text', text }] },
    new AbortController().signal,
  );
  if (sent.kind !== 'stream') throw new Error(`not streaming: ${sent.kind}`);
  await sent.response.text().catch(() => undefined);
  return created.conversation.id;
}

type Row = Record<string, unknown>;

async function trace(
  w: World,
): Promise<{ turns: Row[]; steps: Row[]; events: Row[]; text: string }> {
  const [turns, steps, events] = await Promise.all(
    ['assistant_turns', 'assistant_steps', 'assistant_events'].map((table) =>
      owner.sql.unsafe<Row[]>(`select * from ${table} where tenant_id = '${w.tenantId}'`),
    ),
  );
  const all = {
    turns: [...(turns ?? [])],
    steps: [...(steps ?? [])],
    events: [...(events ?? [])].sort((a, b) => Number(a.seq) - Number(b.seq)),
  };
  return { ...all, text: JSON.stringify(all) };
}

const S1 = 'q7Zk3vN0pX2mB9sT4wY8uR1eC6hJ5aLdF0gHiKoPz_-';
const S2 = 'rT5kV9mQ2xZ8cB4nL7wP1sD6fG3hJ0aY_uE9oIiKqM-';
const S3 = 'ONE-TIME-7731-xyzzy';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXBhcnQ';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo';
const PRIVATE_D = 'private-exponent-value-0042';
const RECOVERY = 'recov-aaaa-1111';

describe('the trace of a turn', () => {
  it('stores one turn, its steps with their tokens, and the events in order', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat, ended } = chatOver(
      scripted([toolCall('c1', 'list_clients', {}), answer('You have one client.')], seen),
      result([{ client_id: 'web' }]),
    );
    await turnOf(chat, callerOf(w), 'what clients do I have?');

    const t = await trace(w);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]).toMatchObject({ profile: 'free-chat', stop_reason: 'done' });
    expect(t.turns[0]?.ended_at).not.toBeNull();
    expect(t.turns[0]?.prompt_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(t.steps.map((s) => [s.input_tokens, s.output_tokens, s.slot])).toEqual([
      [11, 5, 'standard'],
      [11, 5, 'standard'],
    ]);
    expect(t.steps.every((s) => s.parent_step_id === null && s.ended_at !== null)).toBe(true);
    const kinds = t.events.map((e) => e.kind);
    expect(kinds.slice(0, 2)).toEqual(['slot_chosen', 'narrowing']);
    for (const kind of ['reservation', 'model_call', 'tool_call', 'tool_result', 'text']) {
      expect(kinds).toContain(kind);
    }
    expect(t.events.find((e) => e.kind === 'slot_chosen')?.payload).toMatchObject({
      slot: 'standard',
      profile: 'free-chat',
      provider: 'mock-provider',
      model_id: 'mock-model',
    });
    expect(t.events.find((e) => e.kind === 'narrowing')?.payload).toMatchObject({
      mode: 'ask',
      writes: 0,
    });
    expect(t.events.find((e) => e.kind === 'tool_call')?.payload).toMatchObject({
      tool: 'list_clients',
    });
    expect(ended[0]).toMatchObject({ traceLost: false, stopReason: 'done' });
  });

  it('keeps the system prompt out and holds its hash, the same for the same prompt', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted([answer('ok')], seen), result([]));
    const caller = callerOf(w);
    await turnOf(chat, caller, 'first');
    await turnOf(chat, caller, 'second');

    const t = await trace(w);
    const prompt = JSON.stringify(seen[0]?.prompt);
    const opening = /"role":"system","content":"([^"]{40})/u.exec(prompt)?.[1];
    expect(opening).toBeDefined();
    expect(t.text).not.toContain(opening);
    const hashes = t.turns.map((turn) => turn.prompt_hash);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('stores nothing of a key, a header or the request the provider received', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('fine')]), result([]));
    await turnOf(chat, callerOf(w), 'hello');
    const t = await trace(w);
    expect(t.text).not.toMatch(/authorization|x-api-key|headers/iu);
  });
});

describe('what the trace masks', () => {
  const secrets = {
    client_id: 'web',
    client_secret: S1,
    registration_access_token: S2,
    one_time_code: S3,
    note: `issued with Bearer ${JWT}`,
    jwks: { keys: [{ kty: 'RSA', kid: 'k1', n: 'public-modulus', e: 'AQAB', d: PRIVATE_D }] },
    password_hash: HASH,
    recovery_codes: [RECOVERY],
  };

  async function leakCheck(): Promise<{ w: World; text: string; seen: Seen[] }> {
    const w = await world();
    const seen: Seen[] = [];
    const replies: (Part[] | Error)[] = [
      // The model passes a secret it read into the next call and then says it aloud.
      toolCall('c1', 'list_clients', { client_id_exact: 'web' }),
      toolCall('c2', 'list_clients', { client_id_exact: S1 }),
      answer(`The secret is ${S1} and the token ${S2}; send Bearer ${JWT} and ${RECOVERY}.`),
    ];
    const { chat } = chatOver(scripted(replies, seen), result(secrets));
    await turnOf(chat, callerOf(w), `my secret is ${S3} please remember it`);
    return { w, text: (await trace(w)).text, seen };
  }

  it('holds none of the secrets a tool returned, the model wrote or the person typed', async () => {
    const { text, seen } = await leakCheck();
    // The model did read them: the test would pass for nothing otherwise.
    const sent = JSON.stringify(seen[1]?.prompt);
    expect(sent).toContain(S1);
    expect(sent).toContain(PRIVATE_D);
    for (const secret of [S1, S2, S3, JWT, HASH, PRIVATE_D, RECOVERY, 'c29tZXNhbHQ']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('[masked]');
    expect(text).toContain('public-modulus');
  });

  it('holds none of the secrets an error message carried', async () => {
    const w = await world();
    const failing = new Error(`the provider refused: client_secret=${S1} Bearer ${JWT} ${S2}`);
    const { chat } = chatOver(scripted([failing]), result([]));
    await turnOf(chat, callerOf(w), 'hello');
    const t = await trace(w);
    expect(t.events.map((e) => e.kind)).toContain('error');
    for (const secret of [S1, JWT, S2]) expect(t.text, secret).not.toContain(secret);
    expect(t.text).toContain('the provider refused');
    expect(t.turns[0]).toMatchObject({ stop_reason: 'error' });
  });

  it('masks an email address in the model’s own text when the tenant masks them', async () => {
    const w = await world(true);
    const { chat } = chatOver(scripted([answer('Write to ada@example.com about it.')]), result([]));
    await turnOf(chat, callerOf(w), 'who do I write to?');
    const t = await trace(w);
    expect(t.text).not.toContain('ada@example.com');
    expect(t.text).toContain('a***@example.com');
  });

  it('keeps an address as it was when the tenant does not mask them', async () => {
    const w = await world(false);
    const { chat } = chatOver(scripted([answer('Write to ada@example.com about it.')]), result([]));
    await turnOf(chat, callerOf(w), 'who do I write to?');
    expect((await trace(w)).text).toContain('ada@example.com');
  });
});

describe('what the agent can reach', () => {
  it('is offered no tool that reads the trace, its audit, its budget or its mode', async () => {
    const w = await world();
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted([answer('ok')], seen), result([]));
    await turnOf(chat, callerOf(w), 'hello');

    const offered = seen[0]?.tools ?? [];
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toEqual(assistantTools(TOOLS).map((entry) => entry.name));
    const reaching = /trace|activity|assistant|conversation|turn|budget/iu;
    expect(offered.filter((name) => reaching.test(name))).toEqual([]);
    expect(TOOLS.map((entry) => entry.name).filter((name) => reaching.test(name))).toEqual([]);
  });
});

describe('integrations', () => {
  it('passes the turn’s events to an operator’s integration beside the recorder', async () => {
    const w = await world();
    const steps = vi.fn();
    const { chat } = chatOver(scripted([answer('ok')]), result([]), {
      telemetry: [{ onStepStart: steps }],
    });
    await turnOf(chat, callerOf(w), 'hello');
    expect(steps).toHaveBeenCalledTimes(1);
    expect((await trace(w)).steps).toHaveLength(1);
  });
});

describe('a trace that cannot be written', () => {
  it('does not stop the turn, and the audit row says the trace is incomplete', async () => {
    const w = await world();
    const { chat, ended, log } = chatOver(scripted([answer('still here')]), result([]));
    await owner.sql`revoke insert on assistant_events from odudu_app`;
    try {
      const id = await turnOf(chat, callerOf(w), 'hello');
      const loaded = await chat.load(callerOf(w), id);
      expect(JSON.stringify(loaded?.messages)).toContain('still here');
    } finally {
      await owner.sql`grant insert on assistant_events to odudu_app`;
    }
    expect(ended[0]).toMatchObject({ traceLost: true, stopReason: 'done' });
    expect(log).toHaveBeenCalledWith('assistant.trace_failed', expect.anything());
  });
});
