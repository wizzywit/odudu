import { ASSISTANT_SETTING_DEFAULTS, type AssistantSettings } from '@odudu/contracts/admin';
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
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeSettings } from '#/usecase/settings';
import type { BudgetAuditEvent } from '#/usecase/chat-deps';
import type { Slot } from '#/service/slots';
import type { TurnStart, TurnSummary } from '#/service/turn-summary';
import { createChat, type Chat, type ChatCaller, type ChatDeps } from '#/view/chat-route';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 10 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

type Part = Record<string, unknown>;

function usage(total: number, output = 2) {
  return {
    inputTokens: { total: total - output, noCache: total - output, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

function answer(text: string, total = 5, output = 2): Part[] {
  return [
    { type: 'text-start', id: 'a' },
    { type: 'text-delta', id: 'a', delta: text },
    { type: 'text-end', id: 'a' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: usage(total, output),
    },
  ];
}

type Reply = Part[] | 'hang' | 'throw';

function scripted(replies: Reply[]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: (options) => {
      const reply = replies[Math.min(call, replies.length - 1)] ?? [];
      call += 1;
      if (reply === 'throw') return Promise.reject(new Error('the provider fell over'));
      if (reply === 'hang') {
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
  structuredContent: { data: [] },
};

interface World {
  tenantId: string;
  alice: string;
}

async function world(settings: Partial<AssistantSettings> = {}): Promise<World> {
  const tenantId = newId();
  const alice = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `loop-${tenantId.slice(-12)}` });
    await tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${alice}, ${tenantId}, 'user')`,
    );
    await writeSettings(tx, tenantId, { ...ASSISTANT_SETTING_DEFAULTS, ...settings }, new Date());
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

function chatOver(model: MockLanguageModelV3, overrides: Partial<ChatDeps> = {}) {
  const slots: Slot[] = [];
  const audits: BudgetAuditEvent[] = [];
  const turns = { started: [] as TurnStart[], ended: [] as TurnSummary[] };
  const chat = createChat({
    transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
    model: (slot) => {
      slots.push(slot);
      return model;
    },
    tools: TOOLS,
    turn: () => ({
      mintToken: vi.fn(() => Promise.resolve({ accessToken: 'token' })),
      callTool: vi.fn(() => Promise.resolve(CLIENTS)),
    }),
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
    audit: (event) => {
      audits.push(event);
      return Promise.resolve();
    },
    now: () => new Date(),
    newId,
    ...overrides,
  });
  return { chat, slots, audits, turns };
}

async function conversation(chat: Chat, caller: ChatCaller): Promise<string> {
  const created = await chat.create(caller, {
    profile: 'free-chat',
    mode: 'ask',
    page_context: { route: '/clients', objectType: 'client', objectId: 'web' },
  });
  if (created.kind !== 'created') throw new Error(`not created: ${created.kind}`);
  return created.conversation.id;
}

const say = (text: string) => ({
  id: newId(),
  role: 'user' as const,
  parts: [{ type: 'text' as const, text }],
});

async function bodyOf(chat: Chat, caller: ChatCaller, id: string, signal?: AbortSignal) {
  const sent = await chat.send(caller, id, say('hello'), signal ?? new AbortController().signal);
  if (sent.kind !== 'stream') throw new Error(`not streaming: ${sent.kind}`);
  return sent.response.text();
}

async function ledger(w: World) {
  return withTenant(app.db, w.tenantId, async (tx) => {
    const counters = await tx.execute<{ scope_kind: string; used: string }>(
      sql`select scope_kind, used::text as used from assistant_budget_counters`,
    );
    const open = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from assistant_reservations where not settled`,
    );
    const reservations = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from assistant_reservations`,
    );
    const leases = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from assistant_turn_leases`,
    );
    return {
      used: Object.fromEntries(counters.map((row) => [row.scope_kind, Number(row.used)])),
      open: open[0]?.n ?? -1,
      reservations: reservations[0]?.n ?? -1,
      leases: leases[0]?.n ?? -1,
    };
  });
}

describe('a turn against the ledger', () => {
  it('reserves before the call and settles to what the provider reported', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('hi', 7)]));
    const body = await bodyOf(chat, callerOf(w), await conversation(chat, callerOf(w)));
    expect(body).toContain('"stopReason":"done"');
    const held = await ledger(w);
    expect(held.used).toEqual({ tenant_month: 7, admin_day: 7, conversation: 7, turn: 7 });
    expect(held).toMatchObject({ open: 0, reservations: 1, leases: 0 });
  });

  it('settles a call whose provider threw, at its full reservation, and gives the place back', async () => {
    const w = await world();
    const { chat } = chatOver(scripted(['throw']));
    const body = await bodyOf(chat, callerOf(w), await conversation(chat, callerOf(w)));
    expect(body).toContain('"stopReason":"error"');
    expect(body).not.toContain('fell over');
    const held = await ledger(w);
    expect(held).toMatchObject({ open: 0, reservations: 1, leases: 0 });
    expect(held.used.tenant_month).toBeGreaterThan(8192);
  });

  it('settles a call that is aborted mid-stream and reports it as aborted', async () => {
    const w = await world();
    const { chat } = chatOver(scripted(['hang']));
    const caller = callerOf(w);
    const id = await conversation(chat, caller);
    const gone = new AbortController();
    const pending = bodyOf(chat, caller, id, gone.signal);
    await vi.waitFor(async () => {
      expect((await ledger(w)).leases).toBe(1);
    });
    gone.abort();
    expect(await pending).toContain('"stopReason":"aborted"');
    expect(await ledger(w)).toMatchObject({ open: 0, leases: 0 });
  });
});

describe('a level that refuses', () => {
  it('ends the turn with a message naming the level and who can change it, never on a cheaper slot', async () => {
    const w = await world({ assistant_monthly_tokens_standard: 0 });
    const model = scripted([answer('never')]);
    const { chat, slots, audits, turns } = chatOver(model);
    const caller = callerOf(w);
    const body = await bodyOf(chat, caller, await conversation(chat, caller));
    expect(turns.started).toHaveLength(1);
    expect(turns.ended).toHaveLength(1);
    expect(turns.ended[0]).toMatchObject({
      outcome: 'refused',
      stopReason: 'budget_tenant',
      steps: 0,
      tokensBySlot: { standard: 0 },
    });

    expect(body).toContain('monthly allowance for the standard model');
    expect(body).toContain('manage-assistant');
    expect(body).toContain('"stopReason":"budget_tenant"');
    expect(model.doStreamCalls).toHaveLength(0);
    expect(new Set(slots)).toEqual(new Set(['standard']));
    expect(await ledger(w)).toMatchObject({ open: 0, leases: 0 });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: 'refused',
      level: 'tenant_month',
      slot: 'standard',
      tenantId: w.tenantId,
      subjectId: w.alice,
      stopReason: 'budget_tenant',
    });
    expect(JSON.stringify(audits)).not.toContain('hello');

    const traced = await withTenant(app.db, w.tenantId, async (tx) => ({
      events: await tx.execute<{ kind: string; payload: Record<string, unknown> }>(
        sql`select kind, payload from assistant_events order by seq`,
      ),
      turns: await tx.execute<{ stop_reason: string }>(
        sql`select stop_reason from assistant_turns`,
      ),
    }));
    expect(traced.turns.map((turn) => turn.stop_reason)).toEqual(['budget_tenant']);
    expect(traced.events.find((event) => event.kind === 'reservation')?.payload).toMatchObject({
      slot: 'standard',
      outcome: 'refused',
      level: 'tenant_month',
    });
  });

  it('refuses on the turn level once a turn has spent its share, and names it', async () => {
    const w = await world();
    const calls: Part[] = [
      { type: 'tool-call', toolCallId: 't1', toolName: 'list_clients', input: '{}' },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: usage(995_000, 994_000),
      },
    ];
    const { chat, audits } = chatOver(scripted([calls, answer('late')]));
    const caller = callerOf(w);
    const body = await bodyOf(chat, caller, await conversation(chat, caller));
    expect(body).toContain('"stopReason":"budget_turn"');
    expect(body).toContain('Ask again');
    expect(audits[0]).toMatchObject({ outcome: 'refused', level: 'turn' });
  });
});

describe('what the provider reports', () => {
  it('charges a call that cost more than was reserved, audits the overrun, and refuses the next turn', async () => {
    const w = await world();
    const { chat, audits } = chatOver(
      scripted([answer('huge', 2_100_000, 2_099_000), answer('again')]),
    );
    const caller = callerOf(w);
    const id = await conversation(chat, caller);
    expect(await bodyOf(chat, caller, id)).toContain('"stopReason":"done"');
    const held = await ledger(w);
    expect(held.used.conversation).toBe(2_100_000);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: 'allowed' });
    expect(audits[0]?.overrunTokens).toBeGreaterThan(0);

    const next = await bodyOf(chat, caller, id);
    // The administrator's day (a quarter of the month) is the first level, in count order, with no room left.
    expect(next).toContain('"stopReason":"budget_admin"');
    expect(audits[1]).toMatchObject({ outcome: 'refused', level: 'admin_day' });
  });

  it('charges the whole reservation for a call that reported no usage, or only zeros', async () => {
    const w = await world();
    const none = [
      { type: 'text-start', id: 'a' },
      { type: 'text-delta', id: 'a', delta: 'quiet' },
      { type: 'text-end', id: 'a' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
      },
    ];
    const { chat } = chatOver(scripted([none]));
    const caller = callerOf(w);
    await bodyOf(chat, caller, await conversation(chat, caller));
    const reserved = await withTenant(app.db, w.tenantId, (tx) =>
      tx.execute<{ reserved: string }>(
        sql`select reserved::text as reserved from assistant_reservations`,
      ),
    );
    expect(reserved).toHaveLength(1);
    expect((await ledger(w)).used.tenant_month).toBe(Number(reserved[0]?.reserved));
  });
});

describe('the warning', () => {
  it('sends a budget_warning part when a level passes 80 percent, once for that level', async () => {
    // A quarter of 400,000 is the day's 100,000, and 85,000 is past 80 percent of it.
    const w = await world({ assistant_monthly_tokens_standard: 400_000 });
    const { chat } = chatOver(scripted([answer('big', 85_000)]));
    const caller = callerOf(w);
    const body = await bodyOf(chat, caller, await conversation(chat, caller));
    expect(body).toContain('"type":"data-budget_warning"');
    expect(body.match(/"level":"admin_day"/gu)).toHaveLength(1);
    expect(body).toContain('"stopReason":"done"');
  });

  it('sends none below 80 percent', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([answer('small')]));
    const caller = callerOf(w);
    expect(await bodyOf(chat, caller, await conversation(chat, caller))).not.toContain(
      'data-budget_warning',
    );
  });
});

describe('answers at once', () => {
  it('refuses the tenant’s next turn with a retry hint, counting turns on another server', async () => {
    const w = await world({ assistant_max_concurrent: 1 });
    const caller = callerOf(w);
    const first = chatOver(scripted(['hang']));
    const second = chatOver(scripted([answer('ok')]));
    const a = await conversation(first.chat, caller);
    const b = await conversation(second.chat, caller);

    const gone = new AbortController();
    const running = bodyOf(first.chat, caller, a, gone.signal);
    await vi.waitFor(async () => {
      expect((await ledger(w)).leases).toBe(1);
    });

    const refused = await second.chat.send(caller, b, say('and me'), new AbortController().signal);
    expect(refused.kind).toBe('limited');
    expect(second.turns.started).toHaveLength(0);
    expect(second.turns.ended).toHaveLength(0);

    gone.abort();
    await running;
    expect(await bodyOf(second.chat, caller, b)).toContain('"stopReason":"done"');
  });

  it('takes the limit from the tenant’s settings, so another tenant is not counted', async () => {
    const busy = await world({ assistant_max_concurrent: 1 });
    const other = await world({ assistant_max_concurrent: 1 });
    const hanging = chatOver(scripted(['hang']));
    const free = chatOver(scripted([answer('ok')]));
    const a = await conversation(hanging.chat, callerOf(busy));
    const gone = new AbortController();
    const running = bodyOf(hanging.chat, callerOf(busy), a, gone.signal);
    await vi.waitFor(async () => {
      expect((await ledger(busy)).leases).toBe(1);
    });
    expect(
      await bodyOf(free.chat, callerOf(other), await conversation(free.chat, callerOf(other))),
    ).toContain('"stopReason":"done"');
    gone.abort();
    await running;
  });
});

describe('the tenant’s step limit', () => {
  it('ends a turn at the tenant’s steps for one answer and reports step_cap', async () => {
    const w = await world({ assistant_max_steps_per_turn: 2 });
    const call: Part[] = [
      { type: 'tool-call', toolCallId: 'c', toolName: 'list_clients', input: '{}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usage(5) },
    ];
    const model = scripted([call]);
    const { chat } = chatOver(model);
    const caller = callerOf(w);
    const body = await bodyOf(chat, caller, await conversation(chat, caller));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(body).toContain('"stopReason":"step_cap"');
  });
});
