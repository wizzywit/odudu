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
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeSettings } from '#/usecase/settings';
import type { TurnStart } from '#/service/turn-summary';
import { createChat, type Chat, type ChatCaller, type ChatDeps } from '#/view/chat-route';

// A system administrator's conversation in another tenant: its rows belong to
// the administrator's tenant, it is bound to the tenant it was created for, the
// stricter of the two tenants' settings applies, and it is offered only the
// tools whose route names a tenant.

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

const CALL: Part[] = [
  { type: 'tool-call', toolCallId: 'c1', toolName: 'list_clients', input: '{}' },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
];
const ANSWER: Part[] = [
  { type: 'text-start', id: 'a' },
  { type: 'text-delta', id: 'a', delta: 'Done.' },
  { type: 'text-end', id: 'a' },
  { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
];

interface Seen {
  prompt: unknown;
  tools: { name: string }[];
}

function scripted(seen: Seen[]): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: (options) => {
      const reply = call % 2 === 0 ? CALL : ANSWER;
      call += 1;
      seen.push({ prompt: options.prompt, tools: (options.tools ?? []) as { name: string }[] });
      return Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          ...reply,
        ] as never),
      });
    },
  });
}

const EMAIL = 'jane.doe@example.com';
const WITH_EMAIL: ToolResult = {
  isError: false,
  content: [{ type: 'text', text: '{}' }],
  structuredContent: { data: [{ client_id: 'web', contact: EMAIL }] },
};

interface World {
  home: string;
  x: string;
  y: string;
  s: string;
  other: string;
}

async function tenant(id: string, name: string, subjects: string[]): Promise<void> {
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name });
    for (const subject of subjects) {
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${subject}, ${id}, 'user')`,
      );
    }
  });
}

async function world(): Promise<World> {
  const w: World = { home: newId(), x: newId(), y: newId(), s: newId(), other: newId() };
  const tag = w.home.slice(-12);
  await tenant(w.home, `ops-${tag}`, [w.s, w.other]);
  await tenant(w.x, `x-${tag}`, []);
  await tenant(w.y, `y-${tag}`, []);
  return w;
}

function callerOf(w: World, target?: 'x' | 'y', subject = w.s): ChatCaller {
  return {
    tenantId: w.home,
    tenantName: 'ops',
    issuer: 'https://id.example/ops',
    ownerSubjectId: subject,
    grantId: newId(),
    requestId: 'req-1',
    ip: '127.0.0.1',
    ...(target === undefined ? {} : { target: { id: w[target], name: target } }),
  };
}

function chatOver(model: MockLanguageModelV3, overrides: Partial<ChatDeps> = {}) {
  const started: TurnStart[] = [];
  const callTool = vi.fn(() => Promise.resolve(WITH_EMAIL));
  const chat: Chat = createChat({
    transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
    model: () => model,
    tools: TOOLS,
    turn: () => ({ mintToken: () => Promise.resolve({ accessToken: 't' }), callTool }),
    recordTurnStart: (start) => {
      started.push(start);
      return Promise.resolve();
    },
    recordTurn: () => Promise.resolve(),
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
  return { chat, started, callTool };
}

const CONTEXT = { route: '/clients', objectType: 'client', objectId: 'web' };

async function create(chat: Chat, caller: ChatCaller, mode: 'ask' | 'act' = 'ask') {
  return chat.create(caller, { profile: 'free-chat', mode, page_context: CONTEXT });
}

async function started(chat: Chat, caller: ChatCaller): Promise<string> {
  const created = await create(chat, caller);
  if (created.kind !== 'created') throw new Error(`not created: ${created.kind}`);
  return created.conversation.id;
}

function say(text: string) {
  return { id: newId(), role: 'user' as const, parts: [{ type: 'text' as const, text }] };
}

async function run(chat: Chat, caller: ChatCaller, id: string) {
  const sent = await chat.send(caller, id, say('hello'), new AbortController().signal);
  if (sent.kind === 'stream') await sent.response.text();
  return sent.kind;
}

async function count(tenantId: string, table: string, where = 'true') {
  const rows = await withTenant(app.db, tenantId, (tx) =>
    tx.execute(sql.raw(`select count(*)::int as n from ${table} where ${where}`)),
  );
  return (rows as unknown as { n: number }[])[0]?.n;
}

async function settle(tenantId: string, over: Partial<typeof ASSISTANT_SETTING_DEFAULTS>) {
  await withTenant(app.db, tenantId, (tx) =>
    writeSettings(tx, tenantId, { ...ASSISTANT_SETTING_DEFAULTS, ...over }, new Date()),
  );
}

describe('the conversation of a system administrator in another tenant', () => {
  it('is a row of the administrator’s tenant that names the tenant it acts in', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));

    const rows = (await owner.db.execute(
      sql`select tenant_id, owner_subject_id, target_tenant_id from assistant_conversations where id = ${id}`,
    )) as unknown as { tenant_id: string; owner_subject_id: string; target_tenant_id: string }[];
    expect(rows).toEqual([{ tenant_id: w.home, owner_subject_id: w.s, target_tenant_id: w.x }]);

    expect(await count(w.home, 'assistant_conversations', `id = '${id}'`)).toBe(1);
    expect(await count(w.x, 'assistant_conversations', `id = '${id}'`)).toBe(0);
    expect(await count(w.x, 'assistant_messages')).toBe(0);
  });

  it('names no target in the administrator’s own tenant', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w));
    const rows = (await owner.db.execute(
      sql`select target_tenant_id from assistant_conversations where id = ${id}`,
    )) as unknown as { target_tenant_id: string | null }[];
    expect(rows[0]?.target_tenant_id).toBeNull();
  });

  it('is never written with a target equal to its own tenant', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, { ...callerOf(w), target: { id: w.home, name: 'ops' } });
    const rows = (await owner.db.execute(
      sql`select target_tenant_id from assistant_conversations where id = ${id}`,
    )) as unknown as { target_tenant_id: string | null }[];
    expect(rows[0]?.target_tenant_id).toBeNull();
    await expect(
      owner.db.execute(
        sql`update assistant_conversations set target_tenant_id = tenant_id where id = ${id}`,
      ),
    ).rejects.toThrow();
  });

  it('is served at the tenant it was created for and at no other path', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));

    expect(await chat.load(callerOf(w, 'x'), id)).toMatchObject({ id });
    expect(await chat.load(callerOf(w, 'y'), id)).toBeNull();
    expect(await chat.load(callerOf(w), id)).toBeNull();
    expect(await chat.approvals(callerOf(w, 'y'), id)).toBeNull();
    expect(await chat.approvals(callerOf(w), id)).toBeNull();
    expect(await chat.stop(callerOf(w, 'y'), id)).toBe('not_found');
    expect(await chat.stop(callerOf(w), id)).toBe('not_found');
    expect(await chat.setMode(callerOf(w, 'y'), id, 'ask')).toEqual({ kind: 'not_found' });
    expect((await chat.resume(callerOf(w, 'y'), id, new AbortController().signal)).kind).toBe(
      'not_found',
    );
    expect(await run(chat, callerOf(w, 'y'), id)).toBe('not_found');
    expect(await run(chat, callerOf(w), id)).toBe('not_found');
  });

  it('is never served to a conversation of the home tenant at a foreign path', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w));
    expect(await chat.load(callerOf(w, 'x'), id)).toBeNull();
    expect(await run(chat, callerOf(w, 'x'), id)).toBe('not_found');
  });

  it('is its owner’s alone, at the right tenant', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));
    expect(await chat.load(callerOf(w, 'x', w.other), id)).toBeNull();
    expect(await run(chat, callerOf(w, 'x', w.other), id)).toBe('not_found');
  });

  it('does not start in Act, nor switch to it, until its approvals reach that tenant', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    expect(await create(chat, callerOf(w, 'x'), 'act')).toEqual({
      kind: 'access_refused',
      reason: 'act_not_offered',
    });
    expect(await count(w.home, 'assistant_conversations')).toBe(0);
    const id = await started(chat, callerOf(w, 'x'));
    expect(await chat.setMode(callerOf(w, 'x'), id, 'act')).toEqual({ kind: 'not_offered' });
  });
});

describe('a turn in another tenant', () => {
  it('records the target on the turn, and leaves it off a turn in the home tenant', async () => {
    const w = await world();
    const away = chatOver(scripted([]));
    await run(away.chat, callerOf(w, 'x'), await started(away.chat, callerOf(w, 'x')));
    expect(away.started[0]).toMatchObject({ tenantId: w.home, targetTenantId: w.x });

    const home = chatOver(scripted([]));
    await run(home.chat, callerOf(w), await started(home.chat, callerOf(w)));
    expect(home.started[0]?.tenantId).toBe(w.home);
    expect(home.started[0]).not.toHaveProperty('targetTenantId');
  });

  it('spends the administrator’s tenant’s budget and leaves the target’s counters empty', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    await run(chat, callerOf(w, 'x'), await started(chat, callerOf(w, 'x')));
    expect(await count(w.home, 'assistant_budget_counters')).toBeGreaterThan(0);
    expect(await count(w.x, 'assistant_budget_counters')).toBe(0);
    expect(await count(w.x, 'assistant_turn_leases')).toBe(0);
    expect(await count(w.x, 'assistant_turns')).toBe(0);
  });

  it('is offered no tool without a tenant in its route, and every tool in the home tenant', async () => {
    const w = await world();
    const away: Seen[] = [];
    const a = chatOver(scripted(away));
    await run(a.chat, callerOf(w, 'x'), await started(a.chat, callerOf(w, 'x')));
    const awayNames = (away[0]?.tools ?? []).map((tool) => tool.name);
    expect(awayNames).toContain('list_clients');
    expect(awayNames).not.toContain('list_tenants');
    expect(awayNames).not.toContain('count_tenants');

    const own: Seen[] = [];
    const h = chatOver(scripted(own));
    await run(h.chat, callerOf(w), await started(h.chat, callerOf(w)));
    const homeNames = (own[0]?.tools ?? []).map((tool) => tool.name);
    expect(homeNames).toContain('list_tenants');
  });
});

describe('the stricter of the two tenants’ settings', () => {
  it('is not served when the target switched the assistant off, even mid-conversation', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));
    await settle(w.x, { assistant_enabled: false });
    expect(await run(chat, callerOf(w, 'x'), id)).toBe('not_found');
    await settle(w.x, { assistant_enabled: true });
    expect(await run(chat, callerOf(w, 'x'), id)).toBe('stream');
  });

  it('is not served when the administrator’s own tenant switched it off', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));
    await settle(w.home, { assistant_enabled: false });
    expect(await run(chat, callerOf(w, 'x'), id)).toBe('not_found');
  });

  it.each([
    ['neither tenant masks', false, false, false],
    ['only the target masks', false, true, true],
    ['only the administrator’s tenant masks', true, false, true],
    ['both mask', true, true, true],
  ] as const)('masks email addresses when %s', async (_, home, target, masked) => {
    const w = await world();
    await settle(w.home, { assistant_mask_emails: home });
    await settle(w.x, { assistant_mask_emails: target });
    const seen: Seen[] = [];
    const { chat } = chatOver(scripted(seen));
    await run(chat, callerOf(w, 'x'), await started(chat, callerOf(w, 'x')));
    const second = JSON.stringify(seen[1]?.prompt);
    expect(second.includes(EMAIL), `unmasked in the prompt: ${String(masked)}`).toBe(!masked);
  });

  it('keeps the administrator’s tenant’s limits, which pay, whatever the target allows', async () => {
    const w = await world();
    await settle(w.x, { assistant_monthly_tokens_standard: 1000 });
    await settle(w.home, { assistant_monthly_tokens_standard: 4000 });
    const { chat } = chatOver(scripted([]));
    const id = await started(chat, callerOf(w, 'x'));
    expect(await run(chat, callerOf(w, 'x'), id)).toBe('stream');
    const rows = (await owner.db.execute(
      sql`select tenant_id from assistant_budget_counters where tenant_id = ${w.x}`,
    )) as unknown as unknown[];
    expect(rows).toEqual([]);
  });
});

describe('deleting the tenant a conversation acts in', () => {
  it('deletes the conversations and messages made for it, and nothing else', async () => {
    const w = await world();
    const { chat } = chatOver(scripted([]));
    const away = await started(chat, callerOf(w, 'x'));
    const other = await started(chat, callerOf(w, 'y'));
    const home = await started(chat, callerOf(w));
    await owner.db.execute(sql`delete from tenants where id = ${w.x}`);
    const left = (await owner.db.execute(
      sql`select id from assistant_conversations where tenant_id = ${w.home}`,
    )) as unknown as { id: string }[];
    expect(left.map((row) => row.id).sort()).toEqual([other, home].sort());
    expect(left.map((row) => row.id)).not.toContain(away);
    const messages = (await owner.db.execute(
      sql`select count(*)::int as n from assistant_messages where conversation_id = ${away}`,
    )) as unknown as { n: number }[];
    expect(messages[0]?.n).toBe(0);
  });
});
