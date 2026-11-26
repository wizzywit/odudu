import { MAX_LIMIT } from '@odudu/contracts/admin';
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
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationRepository, type NewConversation } from '#/repository/conversations';
import {
  ConversationNotFoundError,
  ConversationTailChangedError,
  MAX_LOAD,
  messageRepository,
} from '#/repository/messages';

interface Recorded {
  query: string;
  parameters: readonly unknown[];
}

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let recorded: Recorded[] = [];

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), {
    max: 5,
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

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `assistant-${tenantId.slice(-12)}` });
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
  );
  return subjectId;
}

function conversation(
  tenantId: string,
  ownerSubjectId: string,
  overrides: Partial<NewConversation> = {},
): NewConversation {
  return {
    id: newId(),
    tenantId,
    ownerSubjectId,
    instanceId: newId(),
    profile: 'free-chat',
    mode: 'ask',
    now: NOW,
    ...overrides,
  };
}

async function errorNameOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    return error instanceof Error ? error.name : String(error);
  }
}

async function refusalOf(attempt: Promise<unknown>): Promise<string | null> {
  try {
    await attempt;
    return null;
  } catch (error) {
    return String(error instanceof Error && error.cause !== undefined ? error.cause : error);
  }
}

// A statement the database refuses aborts its transaction, so the attempt
// runs in a transaction of its own, bound to the given tenant.
async function refusedInTenant(
  tenantId: string,
  attempt: (tx: TenantScopedDatabase) => Promise<unknown>,
): Promise<string | null> {
  return refusalOf(withTenant(app.db, tenantId, attempt));
}

interface Seeded {
  tenantId: string;
  subjectId: string;
  conversationId: string;
}

async function seedConversation(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  const subjectId = await seedTenant(tx, tenantId);
  const created = await conversationRepository(tx).create(conversation(tenantId, subjectId));
  await messageRepository(tx).append(created.id, { role: 'user', parts: [{ type: 'text' }] });
  return { tenantId, subjectId, conversationId: created.id };
}

async function verifySeeded(tx: TenantScopedDatabase, seeded: Seeded): Promise<void> {
  const found = await conversationRepository(tx).byId(seeded.conversationId);
  expect(found?.mode).toBe('ask');
  expect(await messageRepository(tx).load(seeded.conversationId, 10)).toHaveLength(1);
}

describe('every method refuses a foreign tenant', () => {
  it('create', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => ({
        tenantId,
        subjectId: await seedTenant(tx, tenantId),
      }),
      verifySeeded: async (tx, seeded) => {
        const rows = await tx.execute(sql`select 1 from subjects where id = ${seeded.subjectId}`);
        expect(rows).toHaveLength(1);
      },
      // The row names tenant A while the connection is bound to B.
      attempt: async (tx, seeded) => {
        const [bound] = await tx.execute<{ tenant: string }>(
          sql`select current_setting('app.tenant_id') as tenant`,
        );
        expect(bound?.tenant).not.toBe(seeded.tenantId);
        return refusedInTenant(bound?.tenant ?? '', async (own) =>
          conversationRepository(own).create(conversation(seeded.tenantId, seeded.subjectId)),
        );
      },
      expectBlocked: (result) => {
        expect(result).not.toBeNull();
      },
    });
  });

  it('byId', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) => conversationRepository(tx).byId(seeded.conversationId),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });

  it('listByOwner', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) =>
        conversationRepository(tx).listByOwner(seeded.subjectId, null, 10, null),
      expectBlocked: (result) => {
        expect(result).toEqual({ items: [], next: null });
      },
    });
  });

  it('touch', async () => {
    const later = new Date(NOW.getTime() + 60_000);
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) => conversationRepository(tx).touch(seeded.conversationId, later),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const found = await conversationRepository(tx).byId(seeded.conversationId);
        expect(found?.lastActiveAt).toEqual(NOW);
      },
    });
  });

  it('setMode', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) =>
        conversationRepository(tx).setMode(seeded.conversationId, 'act'),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await conversationRepository(tx).byId(seeded.conversationId))?.mode).toBe('ask');
      },
    });
  });

  it('append', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) =>
        errorNameOf(
          messageRepository(tx).append(seeded.conversationId, { role: 'user', parts: [] }),
        ),
      expectBlocked: (result) => {
        expect(result).toBe('ConversationNotFoundError');
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(await messageRepository(tx).load(seeded.conversationId, 10)).toHaveLength(1);
      },
    });
  });

  it('load', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) => messageRepository(tx).load(seeded.conversationId, 10),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('first', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) => messageRepository(tx).first(seeded.conversationId),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });

  it('replaceLast', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) =>
        errorNameOf(
          messageRepository(tx).replaceLast(seeded.conversationId, 1, {
            role: 'assistant',
            parts: [{ type: 'text', text: 'x' }],
          }),
        ),
      expectBlocked: (result) => {
        expect(result).toBe('ConversationNotFoundError');
      },
    });
  });

  it('replaceTail', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedConversation,
      verifySeeded,
      attempt: async (tx, seeded) =>
        errorNameOf(
          messageRepository(tx).replaceTail(seeded.conversationId, 1, [
            { role: 'assistant', parts: [{ type: 'text', text: 'x' }] },
          ]),
        ),
      expectBlocked: (result) => {
        expect(result).toBe('ConversationNotFoundError');
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        const [message] = await messageRepository(tx).load(seeded.conversationId, 10);
        expect(message?.role).toBe('user');
      },
    });
  });
});

describe('conversationRepository', () => {
  async function inTenant<T>(
    fn: (tx: TenantScopedDatabase, tenantId: string, subjectId: string) => Promise<T>,
  ): Promise<T> {
    const tenantId = newId();
    return withTenant(app.db, tenantId, async (tx) =>
      fn(tx, tenantId, await seedTenant(tx, tenantId)),
    );
  }

  it('creates a conversation and reads it back', async () => {
    const found = await inTenant(async (tx, tenantId, subjectId) => {
      const created = await conversationRepository(tx).create(
        conversation(tenantId, subjectId, { profile: 'why-cant-sign-in', mode: 'act' }),
      );
      return conversationRepository(tx).byId(created.id);
    });

    expect(found).toMatchObject({
      profile: 'why-cant-sign-in',
      mode: 'act',
      title: null,
      reportedAt: null,
      createdAt: NOW,
      lastActiveAt: NOW,
    });
  });

  it('refuses a mode outside ask and act', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => seedTenant(tx, tenantId));

    const refusal = await refusedInTenant(tenantId, async (tx) =>
      conversationRepository(tx).create(
        conversation(tenantId, subjectId, { mode: 'free' as unknown as 'ask' }),
      ),
    );

    expect(refusal).toMatch(/assistant_conversations_mode_check/u);
  });

  it('never moves the activity time backwards', async () => {
    const later = new Date(NOW.getTime() + 9_000);
    const earlier = new Date(NOW.getTime() + 3_000);
    const found = await inTenant(async (tx, tenantId, subjectId) => {
      const repo = conversationRepository(tx);
      const created = await repo.create(conversation(tenantId, subjectId));
      await repo.touch(created.id, later);
      expect(await repo.touch(created.id, earlier)).toBe(true);
      return repo.byId(created.id);
    });

    expect(found?.lastActiveAt).toEqual(later);
  });

  it('treats a fractional or non-numeric limit as a whole number of at least one', async () => {
    const sizes = await inTenant(async (tx, tenantId, subjectId) => {
      const repo = conversationRepository(tx);
      for (let n = 0; n < 3; n += 1) await repo.create(conversation(tenantId, subjectId));
      return [
        (await repo.listByOwner(subjectId, null, 2.5, null)).items.length,
        (await repo.listByOwner(subjectId, null, Number.NaN, null)).items.length,
      ];
    });

    expect(sizes).toEqual([2, 1]);
  });

  it('touches the activity time and switches the mode', async () => {
    const later = new Date(NOW.getTime() + 5_000);
    const found = await inTenant(async (tx, tenantId, subjectId) => {
      const repo = conversationRepository(tx);
      const created = await repo.create(conversation(tenantId, subjectId));
      expect(await repo.touch(created.id, later)).toBe(true);
      expect(await repo.setMode(created.id, 'act')).toBe(true);
      return repo.byId(created.id);
    });

    expect(found).toMatchObject({ lastActiveAt: later, mode: 'act', createdAt: NOW });
  });

  it('lists the newest first and resumes from the cursor without a repeat', async () => {
    const pages = await inTenant(async (tx, tenantId, subjectId) => {
      const repo = conversationRepository(tx);
      const ids: string[] = [];
      for (let n = 0; n < 5; n += 1) {
        // Two share a time, so the id decides their order.
        const at = new Date(NOW.getTime() + Math.floor(n / 2) * 1000);
        ids.push((await repo.create(conversation(tenantId, subjectId, { now: at }))).id);
      }
      const first = await repo.listByOwner(subjectId, null, 2, null);
      const second = await repo.listByOwner(subjectId, first.next, 2, null);
      const third = await repo.listByOwner(subjectId, second.next, 2, null);
      return { ids, first, second, third };
    });

    const seen = [...pages.first.items, ...pages.second.items, ...pages.third.items];
    expect(seen.map((item) => item.id).sort()).toEqual([...pages.ids].sort());
    expect(pages.first.next).not.toBeNull();
    expect(pages.third.next).toBeNull();
    const times = seen.map((item) => item.lastActiveAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('lists only the named owner', async () => {
    const items = await inTenant(async (tx, tenantId, subjectId) => {
      const otherId = newId();
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${otherId}, ${tenantId}, 'user')`,
      );
      const repo = conversationRepository(tx);
      await repo.create(conversation(tenantId, subjectId));
      await repo.create(conversation(tenantId, otherId));
      return (await repo.listByOwner(otherId, null, 10, null)).items;
    });

    expect(items).toHaveLength(1);
  });

  it('never reads more than MAX_LIMIT rows however large a limit it is given', async () => {
    recorded = [];
    await inTenant(async (tx, _tenantId, subjectId) =>
      conversationRepository(tx).listByOwner(subjectId, null, MAX_LIMIT * 10, null),
    );

    const listing = recorded.find((entry) =>
      entry.query.includes('from "assistant_conversations"'),
    );
    expect(listing?.parameters).toContain(String(MAX_LIMIT + 1));
  });

  it('serves a page from the owner index, in order, without a sort', async () => {
    const tenantId = newId();
    const owners = 20;
    await withTenant(owner.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `plan-${tenantId.slice(-12)}` });
    });
    await owner.sql`
      insert into subjects (id, tenant_id, type)
      select gen_random_uuid(), ${tenantId}, 'user' from generate_series(1, ${owners})`;
    const subjects = await owner.sql<{ id: string }[]>`
      select id from subjects where tenant_id = ${tenantId} order by id`;
    const target = subjects[0]?.id ?? '';
    await owner.sql`
      insert into assistant_conversations
        (tenant_id, id, owner_subject_id, instance_id, profile, mode, created_at, last_active_at)
      select ${tenantId}, gen_random_uuid(), s.id, gen_random_uuid(), 'free-chat', 'ask',
             now(), now() - (n || ' seconds')::interval
        from (select id from subjects where tenant_id = ${tenantId}) s, generate_series(1, 400) n`;
    await owner.sql`analyze assistant_conversations`;

    recorded = [];
    await withTenant(app.db, tenantId, async (tx) =>
      conversationRepository(tx).listByOwner(target, null, 20, null),
    );
    const listing = recorded.find((entry) =>
      entry.query.includes('from "assistant_conversations"'),
    );
    expect(listing).toBeDefined();

    const plan = await app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
        `EXPLAIN (FORMAT JSON) ${listing?.query ?? ''}`,
        (listing?.parameters ?? []) as never[],
      );
      return JSON.stringify(rows[0]?.['QUERY PLAN']);
    });
    expect(plan).toContain('assistant_conversations_owner_activity');
    expect(plan).not.toContain('"Node Type":"Sort"');
    expect(plan).not.toContain('"Node Type":"Seq Scan"');
  });
});

describe('messageRepository', () => {
  async function inConversation<T>(
    fn: (tx: TenantScopedDatabase, conversationId: string) => Promise<T>,
  ): Promise<T> {
    const tenantId = newId();
    return withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenant(tx, tenantId);
      const created = await conversationRepository(tx).create(conversation(tenantId, subjectId));
      return fn(tx, created.id);
    });
  }

  const text = (value: string) => ({
    role: 'user' as const,
    parts: [{ type: 'text', text: value }],
  });

  it('numbers messages from one, in order', async () => {
    const loaded = await inConversation(async (tx, id) => {
      const repo = messageRepository(tx);
      expect(await repo.append(id, text('a'))).toBe(1);
      expect(await repo.append(id, text('b'))).toBe(2);
      return repo.load(id, 10);
    });

    expect(loaded.map((message) => message.seq)).toEqual([1, 2]);
    expect(loaded[1]?.parts).toEqual([{ type: 'text', text: 'b' }]);
  });

  it('gives two concurrent appends distinct sequence numbers', async () => {
    const tenantId = newId();
    const conversationId = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenant(tx, tenantId);
      return (await conversationRepository(tx).create(conversation(tenantId, subjectId))).id;
    });

    const seqs = await Promise.all(
      Array.from({ length: 4 }, (_, n) =>
        withTenant(app.db, tenantId, async (tx) =>
          messageRepository(tx).append(conversationId, text(`m${String(n)}`)),
        ),
      ),
    );

    expect([...seqs].sort()).toEqual([1, 2, 3, 4]);
  });

  it('loads the latest messages up to the bound, oldest first', async () => {
    const loaded = await inConversation(async (tx, id) => {
      const repo = messageRepository(tx);
      for (let n = 1; n <= 6; n += 1) await repo.append(id, text(`m${String(n)}`));
      return repo.load(id, 3);
    });

    expect(loaded.map((message) => message.seq)).toEqual([4, 5, 6]);
  });

  it('treats a fractional or non-numeric limit as a whole number of at least one', async () => {
    const sizes = await inConversation(async (tx, id) => {
      const repo = messageRepository(tx);
      for (let n = 1; n <= 3; n += 1) await repo.append(id, text(`m${String(n)}`));
      return [(await repo.load(id, 2.5)).length, (await repo.load(id, Number.NaN)).length];
    });

    expect(sizes).toEqual([2, 1]);
  });

  it('names a missing conversation with a typed error', async () => {
    const name = await inConversation(async (tx) =>
      errorNameOf(messageRepository(tx).append(newId(), text('a'))),
    );

    expect(name).toBe('ConversationNotFoundError');
    expect(new ConversationNotFoundError()).toBeInstanceOf(Error);
  });

  it('never loads more than MAX_LOAD whatever limit it is given', async () => {
    recorded = [];
    await inConversation(async (tx, id) => messageRepository(tx).load(id, MAX_LOAD * 10));

    const read = recorded.find((entry) => entry.query.includes('from "assistant_messages"'));
    expect(read?.parameters).toContain(String(MAX_LOAD));
  });

  it('replaces the tail from a sequence number on', async () => {
    const loaded = await inConversation(async (tx, id) => {
      const repo = messageRepository(tx);
      for (let n = 1; n <= 4; n += 1) await repo.append(id, text(`m${String(n)}`));
      const seqs = await repo.replaceTail(id, 3, [
        { role: 'assistant', parts: [{ type: 'text', text: 'summary' }] },
      ]);
      expect(seqs).toEqual([3]);
      return repo.load(id, 10);
    });

    expect(loaded.map((message) => [message.seq, message.role])).toEqual([
      [1, 'user'],
      [2, 'user'],
      [3, 'assistant'],
    ]);
  });

  it('refuses a replacement that would leave a gap', async () => {
    const refusal = await inConversation(async (tx, id) => {
      const repo = messageRepository(tx);
      await repo.append(id, text('a'));
      return refusalOf(repo.replaceTail(id, 5, [text('b')]));
    });

    expect(refusal).toMatch(/gap/u);
  });

  it('refuses an unknown role', async () => {
    const tenantId = newId();
    const id = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedTenant(tx, tenantId);
      return (await conversationRepository(tx).create(conversation(tenantId, subjectId))).id;
    });

    const refusal = await refusedInTenant(tenantId, async (tx) =>
      messageRepository(tx).append(id, { role: 'tool' as unknown as 'user', parts: [] }),
    );

    expect(refusal).toMatch(/assistant_messages_role_check/u);
  });

  it('is removed with its conversation', async () => {
    const remaining = await inConversation(async (tx, id) => {
      await messageRepository(tx).append(id, text('a'));
      await tx.execute(sql`delete from assistant_conversations where id = ${id}`);
      return tx.execute(sql`select 1 from assistant_messages where conversation_id = ${id}`);
    });

    expect(remaining).toHaveLength(0);
  });
});

describe('replaceLast', () => {
  it('replaces the last message, and refuses to touch one that is no longer last', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedTenant(tx, tenantId);
      const created = await conversationRepository(tx).create(conversation(tenantId, subject));
      const messages = messageRepository(tx);
      const seq = await messages.append(created.id, { role: 'assistant', parts: [{ n: 1 }] });
      await messages.replaceLast(created.id, seq, { role: 'assistant', parts: [{ n: 2 }] });
      await messages.append(created.id, { role: 'user', parts: [{ n: 3 }] });
      expect(
        await errorNameOf(
          messages.replaceLast(created.id, seq, { role: 'assistant', parts: [{ n: 4 }] }),
        ),
      ).toBe(ConversationTailChangedError.name);
      const kept = await messages.load(created.id, 10);
      expect(kept.map((m) => m.parts)).toEqual([[{ n: 2 }], [{ n: 3 }]]);
    });
  });
});
