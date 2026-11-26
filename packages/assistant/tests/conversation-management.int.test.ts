import { EXPORT_MESSAGES_MAX, MAX_LIMIT } from '@odudu/contracts/admin';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { TOOLS } from '@odudu/mcp';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationRepository, type ConversationRecord } from '#/repository/conversations';
import { leaseRepository } from '#/repository/leases';
import { messageRepository } from '#/repository/messages';
import { tombstoneRepository } from '#/repository/tombstones';
import { conversationDigest, deriveDigestKey } from '#/service/conversation-digest';
import { createChat, type Chat, type ChatCaller, type ChatDeps } from '#/view/chat-route';
import type { ConversationAuditEvent } from '#/usecase/chat-deps';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let recorded: { query: string; parameters: readonly unknown[] }[] = [];

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), {
    max: 8,
    onQueryForTests: (query, parameters) => {
      recorded.push({ query, parameters });
    },
  });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const KEY = deriveDigestKey(new Uint8Array(32).fill(9));
const CONTEXT = { route: '/clients', objectType: 'client', objectId: 'web' };
const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

function answering(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: text },
          { type: 'text-end', id: 'a' },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
        ] as never),
      }),
  });
}

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
    await tx.insert(tenants).values({ id: tenantId, name: `mgmt-${tenantId.slice(-12)}` });
    for (const id of [alice, bob]) {
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')`,
      );
    }
  });
  return { tenantId, alice, bob };
}

function callerOf(w: World, ownerSubjectId: string, grantId = newId()): ChatCaller {
  return {
    tenantId: w.tenantId,
    ownerSubjectId,
    tenantName: 'acme',
    issuer: 'https://id.example/acme',
    grantId,
    requestId: 'req-1',
    ip: '127.0.0.1',
  };
}

interface Harness {
  chat: Chat;
  events: ConversationAuditEvent[];
  ended: string[];
  clock: { now: Date };
  failAudit: { on: boolean };
  continuable: { value: boolean };
}

function harness(): Harness {
  const events: ConversationAuditEvent[] = [];
  const ended: string[] = [];
  const clock = { now: new Date('2026-11-26T10:00:00.000Z') };
  const failAudit = { on: false };
  const continuable = { value: true };
  const deps: ChatDeps = {
    transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
    model: () => answering('You have two clients.'),
    tools: TOOLS,
    turn: () => ({
      mintToken: () => Promise.resolve({ accessToken: 'token' }),
      callTool: () => Promise.reject(new Error('no tool is called here')),
    }),
    recordTurnStart: () => Promise.resolve(),
    recordTurn: () => Promise.resolve(),
    instanceIdFor: () => newId(),
    withAccess: (caller, _conversation, fn) =>
      withTenant(app.db, caller.tenantId, async (tx) => ({
        kind: 'granted' as const,
        value: await fn(tx),
      })),
    continuable: () => Promise.resolve(continuable.value),
    conversations: {
      digestKey: KEY,
      withAudit: (caller, fn) =>
        withTenant(app.db, caller.tenantId, (tx) =>
          fn(tx, (event) => {
            if (failAudit.on) return Promise.reject(new Error('the audit row failed'));
            events.push(event);
            return Promise.resolve();
          }),
        ),
      endAccess: (_caller, id) => {
        ended.push(id);
        return Promise.resolve();
      },
    },
    now: () => clock.now,
    newId,
  };
  return { chat: createChat(deps), events, ended, clock, failAudit, continuable };
}

async function started(h: Harness, caller: ChatCaller): Promise<string> {
  const created = await h.chat.create(caller, {
    profile: 'free-chat',
    mode: 'ask',
    page_context: CONTEXT,
  });
  if (created.kind !== 'created') throw new Error(`not created: ${created.kind}`);
  return created.conversation.id;
}

async function asked(h: Harness, caller: ChatCaller, id: string, text: string): Promise<void> {
  const sent = await h.chat.send(
    caller,
    id,
    { id: newId(), role: 'user', parts: [{ type: 'text', text }] },
    new AbortController().signal,
  );
  if (sent.kind !== 'stream') throw new Error(`not streaming: ${sent.kind}`);
  await sent.response.text();
}

async function ids(h: Harness, caller: ChatCaller, archived = false): Promise<string[]> {
  const page = await h.chat.list(caller, { archived, after: undefined, limit: 50 });
  if (page.kind !== 'ok') throw new Error('invalid position');
  return page.items.map((item) => item.id);
}

function advance(h: Harness, seconds = 60): void {
  h.clock.now = new Date(h.clock.now.getTime() + seconds * 1000);
}

describe('listing a person’s own conversations', () => {
  it('lists only the caller’s, newest activity first, with a title from the first question', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const older = await started(h, alice);
    await asked(h, alice, older, 'How many clients do I have?\nPlease be quick');
    advance(h);
    const newer = await started(h, alice);
    await asked(h, alice, newer, 'List the groups');
    await started(h, callerOf(w, w.bob));

    const page = await h.chat.list(alice, { archived: false, after: undefined, limit: 50 });
    expect(page.kind).toBe('ok');
    if (page.kind !== 'ok') return;
    expect(page.items.map((item) => item.id)).toEqual([newer, older]);
    expect(page.items.map((item) => item.title)).toEqual([
      'List the groups',
      'How many clients do I have?',
    ]);
    expect(page.items[0]).toMatchObject({
      archived: false,
      archived_at: null,
      reported: false,
      target_tenant_id: null,
      mode: 'ask',
      profile: 'free-chat',
    });
    expect(page.next).toBeNull();
  });

  it('names a conversation once and never from a secret, a link or an address', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'Why can ada@example.com not sign in at https://acme.example/x');
    await asked(h, alice, id, 'Something else entirely');
    const page = await h.chat.list(alice, { archived: false, after: undefined, limit: 5 });
    expect(page.kind === 'ok' && page.items[0]?.title).toBe('Why can not sign in at');
  });

  it('pages without a repeat or a gap and bounds the page at MAX_LIMIT', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const made: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      made.push(await started(h, alice));
      advance(h, n % 2 === 0 ? 0 : 5);
    }
    const seen: string[] = [];
    let after: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await h.chat.list(alice, { archived: false, after, limit: 2 });
      if (page.kind !== 'ok') throw new Error('invalid position');
      seen.push(...page.items.map((item) => item.id));
      if (page.next === null) break;
      after = page.next;
    }
    expect([...seen].sort()).toEqual([...made].sort());
    expect(new Set(seen).size).toBe(5);

    const huge = await h.chat.list(alice, { archived: false, after: undefined, limit: 1_000_000 });
    expect(huge.kind === 'ok' && huge.items.length).toBeLessThanOrEqual(MAX_LIMIT);
  });

  it('refuses a position it did not write', async () => {
    const w = await world();
    const h = harness();
    const page = await h.chat.list(callerOf(w, w.alice), {
      archived: false,
      after: "x'; drop table assistant_conversations; --",
      limit: 5,
    });
    expect(page.kind).toBe('invalid_position');
  });

  it('keeps the conversations made for another tenant out of the home list', async () => {
    const w = await world();
    const h = harness();
    const at = (target: string): ChatCaller => ({
      ...callerOf(w, w.alice),
      target: { id: target, name: 'other' },
    });
    const other = newId();
    await owner.sql`insert into tenants (id, name) values (${other}, ${`tgt-${other.slice(-12)}`})`;
    const home = await started(h, callerOf(w, w.alice));
    await withTenant(app.db, w.tenantId, async (tx) => {
      await tx.execute(sql`
        insert into assistant_conversations
          (tenant_id, id, owner_subject_id, instance_id, profile, mode, target_tenant_id)
        values (${w.tenantId}, ${newId()}, ${w.alice}, ${newId()}, 'free-chat', 'ask', ${other})`);
    });
    expect(await ids(h, callerOf(w, w.alice))).toEqual([home]);
    expect(await ids(h, at(other))).toHaveLength(1);
    expect(await ids(h, at(other))).not.toContain(home);
  });
});

describe('reopening the latest conversation', () => {
  it('returns the latest that is not hidden, with its messages, and null for a person with none', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    expect(await h.chat.last(alice)).toBeNull();

    const first = await started(h, alice);
    await asked(h, alice, first, 'first question');
    advance(h);
    const second = await started(h, alice);
    await asked(h, alice, second, 'second question');

    const last = await h.chat.last(alice);
    expect(last?.id).toBe(second);
    expect(last?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(last).toMatchObject({ archived: false, continuable: true });

    await h.chat.setArchived(alice, second, true);
    expect((await h.chat.last(alice))?.id).toBe(first);
    expect(await h.chat.last(callerOf(w, w.bob))).toBeNull();
  });

  it('says a conversation whose sign-in ended can be read and not continued', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'before the sign-in ended');

    h.continuable.value = false;
    const last = await h.chat.last(alice);
    expect(last).toMatchObject({ id, continuable: false });
    expect(last?.messages).toHaveLength(2);

    const sent = await h.chat.send(
      alice,
      id,
      { id: newId(), role: 'user', parts: [{ type: 'text', text: 'again' }] },
      new AbortController().signal,
    );
    expect(sent.kind).toBe('ended');
    const stored = await withTenant(app.db, w.tenantId, (tx) =>
      messageRepository(tx).load(id, 100),
    );
    expect(stored.filter((message) => message.role === 'user')).toHaveLength(1);
  });
});

describe('hiding a conversation', () => {
  it('moves it between the lists, keeps the first time and removes nothing', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'keep me');

    const hidden = await h.chat.setArchived(alice, id, true);
    expect(hidden.kind).toBe('set');
    expect(await ids(h, alice)).toEqual([]);
    expect(await ids(h, alice, true)).toEqual([id]);
    const firstTime = hidden.kind === 'set' ? hidden.archivedAt : null;
    expect(firstTime).toEqual(h.clock.now);

    advance(h);
    const again = await h.chat.setArchived(alice, id, true);
    expect(again.kind === 'set' && again.archivedAt).toEqual(firstTime);
    expect((await h.chat.load(alice, id))?.messages).toHaveLength(2);

    const back = await h.chat.setArchived(alice, id, false);
    expect(back).toEqual({ kind: 'set', archivedAt: null });
    expect(await ids(h, alice)).toEqual([id]);
    expect(await ids(h, alice, true)).toEqual([]);
  });

  it('is the owner’s alone', async () => {
    const w = await world();
    const h = harness();
    const id = await started(h, callerOf(w, w.alice));
    expect(await h.chat.setArchived(callerOf(w, w.bob), id, true)).toEqual({ kind: 'not_found' });
    expect(await h.chat.setArchived(callerOf(w, w.alice), newId(), true)).toEqual({
      kind: 'not_found',
    });
    expect(await ids(h, callerOf(w, w.alice))).toEqual([id]);
  });
});

describe('deleting a conversation', () => {
  async function counts(w: World, id: string) {
    return withTenant(app.db, w.tenantId, async (tx) => {
      const rows = await tx.execute<{ what: string; n: number }>(sql`
        select 'conversations' as what, count(*)::int as n from assistant_conversations where id = ${id}
        union all select 'messages', count(*)::int from assistant_messages where conversation_id = ${id}
        union all select 'turns', count(*)::int from assistant_turns where conversation_id = ${id}
        union all select 'tombstones', count(*)::int from assistant_conversation_tombstones where conversation_id = ${id}`);
      return Object.fromEntries(rows.map((row) => [row.what, row.n]));
    });
  }

  it('removes the text and leaves a tombstone with a keyed digest, an audit event and no grant', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'delete me');
    const before = await withTenant(app.db, w.tenantId, (tx) =>
      messageRepository(tx).pageAfter(id, 0, 50),
    );
    const digest = conversationDigest(KEY, w.tenantId, id);
    for (const message of before) {
      digest.add({ seq: message.seq, role: message.role, parts: message.parts });
    }
    const expectedDigest = digest.hex();
    advance(h);

    expect(await h.chat.remove(alice, id)).toEqual({ kind: 'deleted' });

    expect(await counts(w, id)).toEqual({
      conversations: 0,
      messages: 0,
      turns: 0,
      tombstones: 1,
    });
    const tombstone = await withTenant(app.db, w.tenantId, (tx) =>
      tombstoneRepository(tx).byConversation(id),
    );
    expect(tombstone).toMatchObject({
      ownerSubjectId: w.alice,
      deletedBySubjectId: w.alice,
      deletedAt: h.clock.now,
      messageCount: before.length,
      turnCount: 1,
      digest: expectedDigest,
    });
    expect(h.events).toEqual([
      {
        action: 'assistant.conversation_deleted',
        conversationId: id,
        messageCount: before.length,
        turnCount: 1,
        digest: expectedDigest,
      },
    ]);
    expect(JSON.stringify(h.events)).not.toContain('delete me');
    expect(h.ended).toEqual([id]);
    expect(await h.chat.load(alice, id)).toBeNull();
    expect(await ids(h, alice)).toEqual([]);
  });

  it('is the owner’s alone and a second delete finds nothing', async () => {
    const w = await world();
    const h = harness();
    const id = await started(h, callerOf(w, w.alice));
    expect(await h.chat.remove(callerOf(w, w.bob), id)).toEqual({ kind: 'not_found' });
    expect((await counts(w, id)).conversations).toBe(1);
    expect(h.events).toEqual([]);

    expect(await h.chat.remove(callerOf(w, w.alice), id)).toEqual({ kind: 'deleted' });
    expect(await h.chat.remove(callerOf(w, w.alice), id)).toEqual({ kind: 'not_found' });
    expect(h.events).toHaveLength(1);
  });

  it('refuses one that is reported, and one a turn is running in, and deletes after', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await owner.sql`update assistant_conversations set reported_at = now() where id = ${id}`;
    expect(await h.chat.remove(alice, id)).toEqual({ kind: 'held' });

    await owner.sql`update assistant_conversations set reported_at = null where id = ${id}`;
    const turnId = newId();
    await withTenant(app.db, w.tenantId, (tx) =>
      leaseRepository(tx).acquire({
        turnId,
        conversationId: id,
        max: 5,
        now: h.clock.now,
        ttlMs: 60_000,
      }),
    );
    expect(await h.chat.remove(alice, id)).toEqual({ kind: 'busy' });
    expect((await counts(w, id)).conversations).toBe(1);

    await withTenant(app.db, w.tenantId, (tx) => leaseRepository(tx).release(turnId));
    expect(await h.chat.remove(alice, id)).toEqual({ kind: 'deleted' });
    expect(h.events).toHaveLength(1);
  });

  it('stands or falls with its audit row: a row that cannot be written deletes nothing', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'still here');

    h.failAudit.on = true;
    await expect(h.chat.remove(alice, id)).rejects.toThrow(/audit row failed/u);
    expect(await counts(w, id)).toEqual({
      conversations: 1,
      messages: 3,
      turns: 1,
      tombstones: 0,
    });
    expect(h.ended).toEqual([]);

    h.failAudit.on = false;
    expect(await h.chat.remove(alice, id)).toEqual({ kind: 'deleted' });
  });

  it('is not offered where the server gave no audit port', async () => {
    const w = await world();
    const bare = createChat({
      transact: (tenantId, fn) => withTenant(app.db, tenantId, fn),
      model: () => answering('x'),
      tools: TOOLS,
      turn: () => ({
        mintToken: () => Promise.resolve({ accessToken: 't' }),
        callTool: () => Promise.reject(new Error('none')),
      }),
      recordTurnStart: () => Promise.resolve(),
      recordTurn: () => Promise.resolve(),
      instanceIdFor: () => newId(),
      withAccess: (caller, _c, fn) =>
        withTenant(app.db, caller.tenantId, async (tx) => ({
          kind: 'granted' as const,
          value: await fn(tx),
        })),
      now: () => new Date(),
      newId,
    });
    const alice = callerOf(w, w.alice);
    const created = await bare.create(alice, { page_context: CONTEXT });
    if (created.kind !== 'created') throw new Error('not created');
    expect(await bare.remove(alice, created.conversation.id)).toEqual({ kind: 'unavailable' });
    expect(await bare.export(alice, created.conversation.id, 'json')).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('exporting a conversation', () => {
  it('gives the owner the text with secrets hidden and the tools named, and writes an audit event', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    await asked(h, alice, id, 'my token is Bearer abcdefghijklmnopqrstuvwxyz0123456789');

    const exported = await h.chat.export(alice, id, 'json');
    expect(exported.kind).toBe('ok');
    if (exported.kind !== 'ok') return;
    expect(exported.document.conversation.id).toBe(id);
    expect(exported.document.truncated).toBe(false);
    expect(exported.document.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(JSON.stringify(exported.document)).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(exported.document.messages[1]?.text).toBe('You have two clients.');
    expect(exported.markdown).toBeUndefined();
    expect(h.events).toEqual([
      {
        action: 'assistant.conversation_exported',
        conversationId: id,
        format: 'json',
        messageCount: 2,
        truncated: false,
      },
    ]);

    const markdown = await h.chat.export(alice, id, 'markdown');
    expect(markdown.kind === 'ok' && markdown.markdown).toContain('## Assistant');
    expect(h.events).toHaveLength(2);
  });

  it('is the owner’s alone, with no audit event for a refused one', async () => {
    const w = await world();
    const h = harness();
    const id = await started(h, callerOf(w, w.alice));
    expect(await h.chat.export(callerOf(w, w.bob), id, 'json')).toEqual({ kind: 'not_found' });
    expect(h.events).toEqual([]);
  });

  it('carries at most EXPORT_MESSAGES_MAX messages and says so', async () => {
    const w = await world();
    const h = harness();
    const alice = callerOf(w, w.alice);
    const id = await started(h, alice);
    const total = EXPORT_MESSAGES_MAX + 20;
    await owner.sql`
      insert into assistant_messages (tenant_id, conversation_id, seq, role, parts)
      select ${w.tenantId}, ${id}, n + 1, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'm' || n))
        from generate_series(1, ${total}) n`;
    const exported = await h.chat.export(alice, id, 'json');
    expect(exported.kind === 'ok' && exported.document.messages).toHaveLength(EXPORT_MESSAGES_MAX);
    expect(exported.kind === 'ok' && exported.document.truncated).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ messageCount: EXPORT_MESSAGES_MAX, truncated: true });
  });
});

describe('every method is probed with a foreign tenant', () => {
  interface Seeded {
    tenantId: string;
    subjectId: string;
    conversationId: string;
    record: ConversationRecord;
  }

  async function seed(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
    await tx.insert(tenants).values({ id: tenantId, name: `probe-${tenantId.slice(-12)}` });
    const subjectId = newId();
    await tx.execute(
      sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
    );
    const created = await conversationRepository(tx).create({
      id: newId(),
      tenantId,
      ownerSubjectId: subjectId,
      instanceId: newId(),
      profile: 'free-chat',
      mode: 'ask',
      now: new Date(),
    });
    await messageRepository(tx).append(created.id, {
      role: 'user',
      parts: [{ type: 'text', text: 'x' }],
    });
    return { tenantId, subjectId, conversationId: created.id, record: created };
  }

  async function verify(tx: TenantScopedDatabase, seeded: Seeded): Promise<void> {
    const rows = await tx.execute(
      sql`select 1 from assistant_conversations where id = ${seeded.conversationId}`,
    );
    expect(rows).toHaveLength(1);
  }

  it('setArchived', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded: verify,
      attempt: (tx, seeded) =>
        conversationRepository(tx).setArchived(seeded.conversationId, true, new Date()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const [row] = await tx.execute<{ archived_at: unknown }>(
          sql`select archived_at from assistant_conversations where id = ${seeded.conversationId}`,
        );
        expect(row?.archived_at).toBeNull();
      },
    });
  });

  it('setTitleOnce', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded: verify,
      attempt: (tx, seeded) => conversationRepository(tx).setTitleOnce(seeded.conversationId, 'x'),
      expectBlocked: () => undefined,
      verifyTenantAUnaffected: async (tx, seeded) => {
        const [row] = await tx.execute<{ title: unknown }>(
          sql`select title from assistant_conversations where id = ${seeded.conversationId}`,
        );
        expect(row?.title).toBeNull();
      },
    });
  });

  it('lock', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded: verify,
      attempt: (tx, seeded) => conversationRepository(tx).lock(seeded.conversationId),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });

  it('pageAfter', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded: verify,
      attempt: (tx, seeded) => messageRepository(tx).pageAfter(seeded.conversationId, 0, 10),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('liveFor', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const seeded = await seed(tx, tenantId);
        await leaseRepository(tx).acquire({
          turnId: newId(),
          conversationId: seeded.conversationId,
          max: 5,
          now: new Date(),
          ttlMs: 600_000,
        });
        return seeded;
      },
      verifySeeded: verify,
      attempt: (tx, seeded) => leaseRepository(tx).liveFor(seeded.conversationId, new Date()),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });

  it('erase and byConversation', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed,
      verifySeeded: verify,
      // The record names tenant A's conversation while the connection is bound to B:
      // the insert of the tombstone is refused and nothing is deleted.
      attempt: async (tx, seeded) => {
        const [bound] = await tx.execute<{ tenant: string }>(
          sql`select current_setting('app.tenant_id') as tenant`,
        );
        expect(bound?.tenant).not.toBe(seeded.tenantId);
        let refused = false;
        try {
          await withTenant(app.db, bound?.tenant ?? '', (own) =>
            tombstoneRepository(own).erase(seeded.record, seeded.subjectId, new Date(), KEY),
          );
        } catch {
          refused = true;
        }
        expect(refused).toBe(true);
        return tombstoneRepository(tx).byConversation(seeded.conversationId);
      },
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });
});

describe('the list reads through an index', () => {
  it('serves each list from its own partial index, in order, in one statement of at most limit + 1 rows', async () => {
    const tenantId = newId();
    await owner.sql`insert into tenants (id, name) values (${tenantId}, ${`plan-${tenantId.slice(-12)}`})`;
    await owner.sql`
      insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), ${tenantId}, 'user' from generate_series(1, 20)`;
    const subjects = await owner.sql<{ id: string }[]>`
      select id from subjects where tenant_id = ${tenantId} order by id`;
    const person = subjects[0]?.id ?? '';
    await owner.sql`
      insert into assistant_conversations
        (tenant_id, id, owner_subject_id, instance_id, profile, mode, created_at, last_active_at, archived_at)
      select ${tenantId}, gen_random_uuid(), s.id, gen_random_uuid(), 'free-chat', 'ask',
             now(), now() - (n || ' seconds')::interval,
             case when n % 4 = 0 then now() else null end
        from (select id from subjects where tenant_id = ${tenantId}) s, generate_series(1, 400) n`;
    // The person also holds conversations at other tenants, which a list for their
    // own tenant, or for one target, must not read past.
    const targets = [newId(), newId()];
    for (const target of targets) {
      await owner.sql`insert into tenants (id, name) values (${target}, ${`tgt-${target.slice(-12)}`})`;
      await owner.sql`
        insert into assistant_conversations
          (tenant_id, id, owner_subject_id, instance_id, profile, mode, created_at, last_active_at, archived_at, target_tenant_id)
        select ${tenantId}, gen_random_uuid(), ${person}, gen_random_uuid(), 'free-chat', 'ask',
               now(), now() + (n || ' seconds')::interval, case when n % 4 = 0 then now() else null end, ${target}
          from generate_series(1, 6000) n`;
    }
    await owner.sql`analyze assistant_conversations`;

    const lists = [
      [false, 'assistant_conversations_owner_open', null],
      [true, 'assistant_conversations_owner_archived', null],
      [false, 'assistant_conversations_owner_open', targets[0] ?? ''],
      [true, 'assistant_conversations_owner_archived', targets[1] ?? ''],
    ] as const;
    for (const [archived, index, target] of lists) {
      recorded = [];
      const first = await withTenant(app.db, tenantId, (tx) =>
        conversationRepository(tx).listByOwner(person, {
          archived,
          tenant: tenantId,
          target,
          limit: 20,
        }),
      );
      expect(first.items).toHaveLength(20);
      expect(first.items.every((row) => row.targetTenantId === target)).toBe(true);
      expect(first.next).not.toBeNull();
      const second = await withTenant(app.db, tenantId, (tx) =>
        conversationRepository(tx).listByOwner(person, {
          archived,
          tenant: tenantId,
          target,
          limit: 20,
          after: first.next ?? undefined,
        }),
      );
      expect(second.items.map((row) => row.id)).not.toContain(first.items[0]?.id);
      const listings = recorded.filter((entry) =>
        entry.query.includes('from assistant_conversations c'),
      );
      expect(listings).toHaveLength(2);
      for (const listing of listings) {
        const plan = await app.sql.begin(async (tx) => {
          await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
          const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${listing.query}`,
            listing.parameters as never[],
          );
          return JSON.stringify(rows[0]?.['QUERY PLAN']);
        });
        expect(plan, `archived=${String(archived)} target=${String(target)} ${plan}`).toContain(
          index,
        );
        expect(plan, plan).not.toContain('"Node Type":"Sort"');
        expect(plan).not.toContain('"Node Type":"Seq Scan"');
        // No row of the person's other lists is read and thrown away.
        expect(plan).not.toMatch(/"Rows Removed by (Index Recheck|Filter)":[1-9]/u);
      }
    }
  });
});
