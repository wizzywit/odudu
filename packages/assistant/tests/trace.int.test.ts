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
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationRepository } from '#/repository/conversations';
import { traceRepository } from '#/repository/trace';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const HASH = 'a'.repeat(64);

interface Seeded {
  tenantId: string;
  conversationId: string;
  turnId: string;
  stepId: string;
}

async function seedConversation(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `trace-${tenantId.slice(-12)}` });
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
  );
  const conversationId = newId();
  await conversationRepository(tx).create({
    id: conversationId,
    tenantId,
    ownerSubjectId: subjectId,
    instanceId: newId(),
    profile: 'free-chat',
    mode: 'ask',
    now: NOW,
  });
  return conversationId;
}

async function seedTrace(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  const conversationId = await seedConversation(tx, tenantId);
  const repo = traceRepository(tx);
  const turnId = newId();
  const stepId = newId();
  await repo.openTurn({
    tenantId,
    id: turnId,
    conversationId,
    profile: 'free-chat',
    promptHash: HASH,
    startedAt: NOW,
  });
  await repo.openStep({
    tenantId,
    turnId,
    id: stepId,
    parentStepId: null,
    slot: 'standard',
    model: 'mock',
    startedAt: NOW,
  });
  return { tenantId, conversationId, turnId, stepId };
}

async function count(tx: TenantScopedDatabase, table: string, where = sql`true`): Promise<number> {
  const rows = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where ${where}`,
  );
  return rows[0]?.n ?? 0;
}

async function refusal(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
    return '';
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    return `${error instanceof Error ? error.message : String(error)} ${
      cause instanceof Error ? cause.message : ''
    }`;
  }
}

// Runs `attempt` as a tenant that is not the one that seeded the rows, in a
// transaction of its own, and returns the refusal's text ('' if none). The probe's
// own transaction cannot hold the failed statement: a refusal aborts it.
function asForeign(
  attempt: (repo: ReturnType<typeof traceRepository>, tenantId: string) => Promise<unknown>,
): Promise<string> {
  const tenantId = crypto.randomUUID();
  return refusal(withTenant(app.db, tenantId, (tx) => attempt(traceRepository(tx), tenantId)));
}

describe('the trace repository', () => {
  it('opens a turn and a step, appends events, and closes both once', async () => {
    const tenantId = newId();
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedTrace(tx, tenantId);
      const repo = traceRepository(tx);
      await repo.appendEvents(tenantId, seeded.turnId, [
        { seq: 0, stepId: null, kind: 'slot_chosen', payload: { slot: 'standard' }, at: NOW },
        { seq: 1, stepId: seeded.stepId, kind: 'text', payload: { text: 'hi' }, at: NOW },
      ]);
      const step = await repo.closeStep({
        tenantId,
        id: seeded.stepId,
        providerRequestId: 'req-1',
        inputTokens: 10,
        outputTokens: 4,
        endedAt: NOW,
      });
      const again = await repo.closeStep({
        tenantId,
        id: seeded.stepId,
        providerRequestId: 'req-2',
        inputTokens: 99,
        outputTokens: 99,
        endedAt: NOW,
      });
      const turn = await repo.closeTurn(tenantId, seeded.turnId, NOW, 'done');
      const turnAgain = await repo.closeTurn(tenantId, seeded.turnId, NOW, 'error');
      const stored = await tx.execute(
        sql`select s.provider_request_id, s.input_tokens, t.stop_reason
              from assistant_steps s join assistant_turns t on t.id = s.turn_id and t.tenant_id = s.tenant_id`,
      );
      const events = await tx.execute<{ seq: number; kind: string }>(
        sql`select seq, kind from assistant_events order by seq`,
      );
      return { step, again, turn, turnAgain, stored: stored[0], events: [...events] };
    });
    expect(result).toMatchObject({ step: true, again: false, turn: true, turnAgain: false });
    expect(result.stored).toMatchObject({
      provider_request_id: 'req-1',
      input_tokens: 10,
      stop_reason: 'done',
    });
    expect(result.events).toEqual([
      { seq: 0, kind: 'slot_chosen' },
      { seq: 1, kind: 'text' },
    ]);
  });

  it('nests a step under the step that spawned it, and removes both with the conversation', async () => {
    const tenantId = newId();
    const counts = await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedTrace(tx, tenantId);
      const repo = traceRepository(tx);
      await repo.openStep({
        tenantId,
        turnId: seeded.turnId,
        id: newId(),
        parentStepId: seeded.stepId,
        slot: 'fast',
        model: 'mock',
        startedAt: NOW,
      });
      await repo.appendEvents(tenantId, seeded.turnId, [
        { seq: 0, stepId: seeded.stepId, kind: 'text', payload: {}, at: NOW },
      ]);
      const before = [
        await count(tx, 'assistant_turns'),
        await count(tx, 'assistant_steps'),
        await count(tx, 'assistant_events'),
      ];
      await tx.execute(
        sql`delete from assistant_conversations where id = ${seeded.conversationId}`,
      );
      const after = [
        await count(tx, 'assistant_turns'),
        await count(tx, 'assistant_steps'),
        await count(tx, 'assistant_events'),
      ];
      return { before, after };
    });
    expect(counts).toEqual({ before: [1, 2, 1], after: [0, 0, 0] });
  });

  it('refuses what the schema bounds, so a writer that forgets its cap cannot grow a turn', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedTrace(tx, tenantId));
    const attempt = (fn: (repo: ReturnType<typeof traceRepository>) => Promise<unknown>) =>
      refusal(withTenant(app.db, tenantId, (tx) => fn(traceRepository(tx))));
    const event = (over: Record<string, unknown>) => ({
      seq: 0,
      stepId: null,
      kind: 'text' as const,
      payload: {},
      at: NOW,
      ...over,
    });
    expect(
      await attempt((r) => r.appendEvents(tenantId, seeded.turnId, [event({ seq: 500 })])),
    ).toContain('assistant_events_seq_range');
    expect(
      await attempt((r) =>
        r.appendEvents(tenantId, seeded.turnId, [event({ payload: { t: 'x'.repeat(17_000) } })]),
      ),
    ).toContain('assistant_events_payload_shape');
    expect(
      await attempt((r) => r.appendEvents(tenantId, seeded.turnId, [event({ kind: 'prompt' })])),
    ).toContain('assistant_events_kind_check');
    expect(
      await attempt((r) =>
        r.openTurn({
          tenantId,
          id: newId(),
          conversationId: seeded.conversationId,
          profile: 'free-chat',
          promptHash: 'not-a-hash',
          startedAt: NOW,
        }),
      ),
    ).toContain('assistant_turns_prompt_hash_shape');
    expect(
      await attempt((r) =>
        r.openStep({
          tenantId,
          turnId: seeded.turnId,
          id: newId(),
          parentStepId: null,
          slot: 'huge' as never,
          model: 'm',
          startedAt: NOW,
        }),
      ),
    ).toContain('assistant_steps_slot_check');
  });

  it('refuses a second event at the same place in a turn', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedTrace(tx, tenantId));
    const row = { seq: 3, stepId: null, kind: 'text' as const, payload: {}, at: NOW };
    await withTenant(app.db, tenantId, (tx) =>
      traceRepository(tx).appendEvents(tenantId, seeded.turnId, [row]),
    );
    expect(
      await refusal(
        withTenant(app.db, tenantId, (tx) =>
          traceRepository(tx).appendEvents(tenantId, seeded.turnId, [row]),
        ),
      ),
    ).toContain('assistant_events_pkey');
  });
});

describe('tenant isolation of the trace', () => {
  const second = async (): Promise<{ a: Seeded; b: string }> => {
    const a = newId();
    const b = newId();
    const seeded = await withTenant(app.db, a, (tx) => seedTrace(tx, a));
    await withTenant(app.db, b, (tx) => seedConversation(tx, b));
    return { a: seeded, b };
  };

  it('names the foreign key that refuses another tenant’s turn, step and conversation', async () => {
    const { a, b } = await second();
    const asB = <T>(fn: (repo: ReturnType<typeof traceRepository>) => Promise<T>) =>
      withTenant(app.db, b, (tx) => fn(traceRepository(tx)));
    expect(
      await refusal(
        asB((r) =>
          r.openTurn({
            tenantId: b,
            id: newId(),
            conversationId: a.conversationId,
            profile: 'free-chat',
            promptHash: HASH,
            startedAt: NOW,
          }),
        ),
      ),
    ).toContain('assistant_turns_conversation_fk');
    expect(
      await refusal(
        asB((r) =>
          r.openStep({
            tenantId: b,
            turnId: a.turnId,
            id: newId(),
            parentStepId: null,
            slot: 'fast',
            model: 'm',
            startedAt: NOW,
          }),
        ),
      ),
    ).toContain('assistant_steps_turn_fk');
    expect(
      await refusal(
        asB((r) =>
          r.appendEvents(b, a.turnId, [
            { seq: 0, stepId: null, kind: 'text', payload: {}, at: NOW },
          ]),
        ),
      ),
    ).toContain('assistant_events_turn_fk');
    expect(
      await refusal(
        asB((r) =>
          r.appendEvents(a.tenantId, a.turnId, [
            { seq: 1, stepId: null, kind: 'text', payload: {}, at: NOW },
          ]),
        ),
      ),
    ).toContain('row-level security');
  });

  it('does not let tenant B close tenant A’s step or turn', async () => {
    const { a, b } = await second();
    const outcome = await withTenant(app.db, b, async (tx) => {
      const repo = traceRepository(tx);
      return {
        step: await repo.closeStep({
          tenantId: a.tenantId,
          id: a.stepId,
          providerRequestId: null,
          inputTokens: 1,
          outputTokens: 1,
          endedAt: NOW,
        }),
        turn: await repo.closeTurn(a.tenantId, a.turnId, NOW, 'done'),
      };
    });
    expect(outcome).toEqual({ step: false, turn: false });
    const open = await withTenant(app.db, a.tenantId, async (tx) => ({
      steps: await count(tx, 'assistant_steps', sql`ended_at is null`),
      turns: await count(tx, 'assistant_turns', sql`ended_at is null`),
    }));
    expect(open).toEqual({ steps: 1, turns: 1 });
  });

  it('probes openTurn with a foreign tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => (await seedTrace(tx, tenantId)).conversationId,
      verifySeeded: async (tx, conversationId) => {
        expect(await count(tx, 'assistant_turns', sql`conversation_id = ${conversationId}`)).toBe(
          1,
        );
      },
      attempt: (_tx, conversationId) =>
        asForeign((repo, tenantId) =>
          repo.openTurn({
            tenantId,
            id: newId(),
            conversationId,
            profile: 'free-chat',
            promptHash: HASH,
            startedAt: NOW,
          }),
        ),
      expectBlocked: (result) => {
        expect(result).not.toBe('');
      },
    });
  });

  it('probes openStep with a foreign tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedTrace(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect(await count(tx, 'assistant_steps', sql`turn_id = ${seeded.turnId}`)).toBe(1);
      },
      attempt: (_tx, seeded) =>
        asForeign((repo, tenantId) =>
          repo.openStep({
            tenantId,
            turnId: seeded.turnId,
            id: newId(),
            parentStepId: null,
            slot: 'fast',
            model: 'm',
            startedAt: NOW,
          }),
        ),
      expectBlocked: (result) => {
        expect(result).not.toBe('');
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await count(tx, 'assistant_steps')).toBe(1);
      },
    });
  });

  it('probes appendEvents with a foreign tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedTrace(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect(await count(tx, 'assistant_turns', sql`id = ${seeded.turnId}`)).toBe(1);
      },
      attempt: (_tx, seeded) =>
        asForeign((repo, tenantId) =>
          repo.appendEvents(tenantId, seeded.turnId, [
            { seq: 0, stepId: null, kind: 'text', payload: {}, at: NOW },
          ]),
        ),
      expectBlocked: (result) => {
        expect(result).not.toBe('');
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await count(tx, 'assistant_events')).toBe(0);
      },
    });
  });

  it('probes closeStep and closeTurn with a foreign tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedTrace(tx, tenantId),
      verifySeeded: async (tx, seeded) => {
        expect(await count(tx, 'assistant_turns', sql`id = ${seeded.turnId}`)).toBe(1);
      },
      attempt: async (tx, seeded) => {
        const repo = traceRepository(tx);
        const other = crypto.randomUUID();
        return {
          step: await repo.closeStep({
            tenantId: other,
            id: seeded.stepId,
            providerRequestId: null,
            inputTokens: 1,
            outputTokens: 1,
            endedAt: NOW,
          }),
          turn: await repo.closeTurn(other, seeded.turnId, NOW, 'done'),
        };
      },
      expectBlocked: (result) => {
        expect(result).toEqual({ step: false, turn: false });
      },
      verifyTenantAUnaffected: async (tx) => {
        expect(await count(tx, 'assistant_turns', sql`ended_at is null`)).toBe(1);
      },
    });
  });
});

describe('the trace at volume', () => {
  it('serves a conversation, retention and each cascade lookup from an index', async () => {
    const tenantId = newId();
    await owner.sql`insert into tenants (id, name) values (${tenantId}, ${`vol-${tenantId.slice(-12)}`})`;
    const subjectId = newId();
    await owner.sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`;
    await owner.sql`
      insert into assistant_conversations (tenant_id, id, owner_subject_id, instance_id, profile, mode)
      select ${tenantId}, gen_random_uuid(), ${subjectId}, gen_random_uuid(), 'free-chat', 'ask'
        from generate_series(1, 200)`;
    await owner.sql`
      insert into assistant_turns (tenant_id, id, conversation_id, profile, prompt_hash, started_at)
      select ${tenantId}, gen_random_uuid(), c.id, 'free-chat', repeat('a', 64),
             now() - ((n * 2) || ' minutes')::interval
        from generate_series(1, 40000) n
        join (select id, row_number() over () as r from assistant_conversations
               where tenant_id = ${tenantId}) c on c.r = 1 + n % 200`;
    await owner.sql`
      insert into assistant_steps (tenant_id, turn_id, id, slot, model, started_at)
      select tenant_id, id, gen_random_uuid(), 'standard', 'mock', started_at
        from assistant_turns where tenant_id = ${tenantId}`;
    await owner.sql`
      insert into assistant_events (tenant_id, turn_id, seq, step_id, kind, payload, at)
      select s.tenant_id, s.turn_id, k, s.id, 'text',
             jsonb_build_object('text', repeat('x', 1500)), s.started_at
        from assistant_steps s, generate_series(0, 2) k where s.tenant_id = ${tenantId}`;
    // A tenth of the turns have a second step that a first one spawned.
    await owner.sql`
      insert into assistant_steps (tenant_id, turn_id, id, parent_step_id, slot, model, started_at)
      select tenant_id, turn_id, gen_random_uuid(), id, 'fast', 'mock', started_at
        from assistant_steps where tenant_id = ${tenantId} and abs(hashtext(id::text)) % 10 = 0`;
    // Another tenant's rows beside them, as in a deployment with many.
    const noise = newId();
    await owner.sql`insert into tenants (id, name) values (${noise}, ${`noise-${noise.slice(-12)}`})`;
    const noiseSubject = newId();
    await owner.sql`insert into subjects (id, tenant_id, type) values (${noiseSubject}, ${noise}, 'user')`;
    await owner.sql`
      insert into assistant_conversations (tenant_id, id, owner_subject_id, instance_id, profile, mode)
      select ${noise}, gen_random_uuid(), ${noiseSubject}, gen_random_uuid(), 'free-chat', 'ask'
        from generate_series(1, 50)`;
    await owner.sql`
      insert into assistant_turns (tenant_id, id, conversation_id, profile, prompt_hash, started_at)
      select ${noise}, gen_random_uuid(), c.id, 'free-chat', repeat('b', 64),
             now() - ((n * 3) || ' minutes')::interval
        from generate_series(1, 10000) n
        join (select id, row_number() over () as r from assistant_conversations
               where tenant_id = ${noise}) c on c.r = 1 + n % 50`;
    await owner.sql`analyze assistant_turns`;
    await owner.sql`analyze assistant_steps`;
    await owner.sql`analyze assistant_events`;

    // What a turn of three 1.5 KB events costs on disk with its indexes, so the
    // estimate in the operating page rests on a measurement.
    const [{ bytes_per_turn: bytesPerTurn } = { bytes_per_turn: 0 }] = await owner.sql<
      { bytes_per_turn: number }[]
    >`select (
         (pg_total_relation_size('assistant_turns') + pg_total_relation_size('assistant_steps')
          + pg_total_relation_size('assistant_events')) / (select count(*) from assistant_turns)
       )::int as bytes_per_turn`;
    expect(bytesPerTurn).toBeGreaterThan(4_000);
    expect(bytesPerTurn).toBeLessThan(12_000);
    const [{ old: old } = { old: 0 }] = await owner.sql<{ old: number }[]>`
      select count(*)::int as old from assistant_turns
       where tenant_id = ${tenantId} and started_at < now() - interval '30 days'`;
    expect(old).toBeGreaterThan(10_000);

    const [{ conversation_id: conversationId, id: turnId, step_id: stepId } = {}] = await owner.sql<
      { conversation_id: string; id: string; step_id: string }[]
    >`select t.conversation_id, t.id, s.id as step_id
        from assistant_turns t join assistant_steps s on s.turn_id = t.id and s.tenant_id = t.tenant_id
       where t.tenant_id = ${tenantId} limit 1`;

    const dialect = new PgDialect();
    const statements = [
      // A conversation's turns, newest first.
      sql`select * from assistant_turns where tenant_id = ${tenantId}
            and conversation_id = ${conversationId} order by started_at desc limit 200`,
      // What retention reads: the tenant's oldest turns past a cutoff, a batch at a time.
      sql`select id from assistant_turns where tenant_id = ${tenantId}
            and started_at < now() - interval '30 days' order by started_at limit 1000`,
      // What deleting a turn, a step or a parent step looks up.
      sql`select 1 from assistant_steps where tenant_id = ${tenantId} and turn_id = ${turnId}`,
      sql`select 1 from assistant_events where tenant_id = ${tenantId} and turn_id = ${turnId} order by seq`,
      sql`select 1 from assistant_events where tenant_id = ${tenantId} and step_id = ${stepId}`,
      sql`select 1 from assistant_steps where tenant_id = ${tenantId} and parent_step_id = ${stepId}`,
    ].map((entry) => dialect.sqlToQuery(entry));

    const plans = await app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const out: string[] = [];
      for (const statement of statements) {
        const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
          `EXPLAIN (FORMAT JSON) ${statement.sql}`,
          statement.params as never[],
        );
        out.push(JSON.stringify(rows[0]?.['QUERY PLAN']));
      }
      return out;
    });
    expect(plans[0]).toContain('assistant_turns_conversation');
    expect(plans[1]).toContain('assistant_turns_started');
    expect(plans[2]).toContain('assistant_steps_turn');
    expect(plans[3]).toContain('assistant_events_pkey');
    expect(plans[4]).toContain('assistant_events_step');
    expect(plans[5]).toContain('assistant_steps_parent');
    for (const plan of plans) expect(plan).not.toContain('"Node Type":"Seq Scan"');
  }, 120_000);
});
