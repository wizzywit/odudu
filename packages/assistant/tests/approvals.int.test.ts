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
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  approvalCardRepository,
  pendingCardsStatement,
  type CardBody,
} from '#/repository/approvals';
import { conversationRepository } from '#/repository/conversations';

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
const LATER = new Date(NOW.getTime() + 600_000);

const BODY: CardBody = {
  title: 'Change the description of a role',
  target: { type: 'role', id: 'r1', name: 'auditors' },
  before: { description: 'old' },
  after: { description: 'new' },
};

interface Seeded {
  tenantId: string;
  conversationId: string;
  approvalId: string;
  toolCallId: string;
}

// A tenant with a person, the assistant's client, a conversation and a pending
// approval for it, with the card stored beside it.
async function seedCard(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  await tx.insert(tenants).values({ id: tenantId, name: `cards-${tenantId.slice(-12)}` });
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
  );
  const clientId = newId();
  await tx.execute(
    sql`insert into clients (id, tenant_id, client_id, name, type)
        values (${clientId}, ${tenantId}, 'odudu-assistant', 'Assistant', 'public')`,
  );
  const conversation = await conversationRepository(tx).create({
    id: newId(),
    tenantId,
    ownerSubjectId: subjectId,
    instanceId: newId(),
    profile: 'free-chat',
    mode: 'act',
    now: NOW,
  });
  const approvalId = newId();
  await tx.execute(
    sql`insert into agent_approvals
          (id, tenant_id, subject_id, requesting_client_id, kind, summary, action_digest, expires_at)
        values (${approvalId}, ${tenantId}, ${subjectId}, ${clientId}, 'assistant_write',
                'Change a role', 'digest', ${LATER.toISOString()}::timestamptz)`,
  );
  const toolCallId = `call-${approvalId.slice(-6)}`;
  await approvalCardRepository(tx).create({
    approvalId,
    conversationId: conversation.id,
    toolCallId,
    tool: 'update_role_description',
    body: BODY,
  });
  return { tenantId, conversationId: conversation.id, approvalId, toolCallId };
}

async function verifySeeded(tx: TenantScopedDatabase, seeded: Seeded): Promise<void> {
  const found = await approvalCardRepository(tx).byApproval(seeded.approvalId);
  expect(found?.body).toEqual(BODY);
  expect(found?.state).toBe('pending');
}

describe('the cards of pending changes', () => {
  it('are read with the state and expiry of their approval', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedCard(tx, tenantId));
    await withTenant(app.db, tenantId, async (tx) => {
      const repository = approvalCardRepository(tx);
      expect(await repository.byCall(seeded.conversationId, seeded.toolCallId)).toMatchObject({
        approvalId: seeded.approvalId,
        tool: 'update_role_description',
        state: 'pending',
        expiresAt: LATER,
      });
      const pending = await repository.pending(seeded.conversationId, NOW);
      expect(pending.map((row) => row.approvalId)).toEqual([seeded.approvalId]);
      expect(
        await repository.pending(seeded.conversationId, new Date(LATER.getTime() + 1)),
      ).toEqual([]);
      expect(
        await repository.forCalls(seeded.conversationId, [seeded.toolCallId, 'x']),
      ).toHaveLength(1);
      expect(await repository.forCalls(seeded.conversationId, [])).toEqual([]);
    });
  });

  it('are one to a tool call of a conversation', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedCard(tx, tenantId));
    await expect(
      withTenant(app.db, tenantId, (tx) =>
        approvalCardRepository(tx).create({
          approvalId: seeded.approvalId,
          conversationId: seeded.conversationId,
          toolCallId: seeded.toolCallId,
          tool: 'update_role_description',
          body: BODY,
        }),
      ),
    ).rejects.toThrow();
  });

  it('go with their conversation', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedCard(tx, tenantId));
    await owner.db.execute(
      sql`delete from assistant_conversations where id = ${seeded.conversationId}`,
    );
    const left = await owner.db.execute<{ n: number }>(
      sql`select count(*)::int as n from assistant_approvals where tenant_id = ${tenantId}`,
    );
    expect(left[0]?.n).toBe(0);
  });
});

describe('the list of a conversation’s pending changes, at volume', () => {
  it('is served from the conversation’s index with no scan of the table', async () => {
    const tenantId = newId();
    const seeded = await withTenant(app.db, tenantId, (tx) => seedCard(tx, tenantId));
    const [found] = await owner.sql<{ subject_id: string; requesting_client_id: string }[]>`
        select subject_id, requesting_client_id from agent_approvals where id = ${seeded.approvalId}`;
    const subjectId = found?.subject_id ?? '';
    const clientId = found?.requesting_client_id ?? '';
    // Twenty thousand approvals over two thousand conversations of one tenant.
    await owner.sql`
      insert into assistant_conversations
        (tenant_id, id, owner_subject_id, instance_id, profile, mode)
      select ${tenantId}, gen_random_uuid(), ${subjectId}, gen_random_uuid(), 'free-chat', 'act'
        from generate_series(1, 2000)`;
    await owner.sql`
      insert into agent_approvals
        (id, tenant_id, subject_id, requesting_client_id, kind, summary, action_digest, state, expires_at)
      select gen_random_uuid(), ${tenantId}, ${subjectId}, ${clientId}, 'assistant_write', 's', 'd',
             (array['pending','approved','denied','consumed'])[1 + n % 4], now() + interval '5 minutes'
        from generate_series(1, 20000) n`;
    await owner.sql`
      insert into assistant_approvals (tenant_id, approval_id, conversation_id, tool_call_id, tool, card)
      select ${tenantId}, a.id, c.id, 'call-' || a.id, 'update_role_description', '{}'::jsonb
        from (select id, row_number() over () as n from agent_approvals
               where tenant_id = ${tenantId} and kind = 'assistant_write'
                 and id <> ${seeded.approvalId}) a
        join (select id, row_number() over () as n from assistant_conversations
               where tenant_id = ${tenantId} and id <> ${seeded.conversationId}) c
          on c.n = 1 + (a.n % 2000)`;
    // And five thousand old, spent cards in the one conversation the list is read for.
    await owner.sql`
      insert into agent_approvals
        (id, tenant_id, subject_id, requesting_client_id, kind, summary, action_digest, state, expires_at, created_at)
      select gen_random_uuid(), ${tenantId}, ${subjectId}, ${clientId}, 'assistant_write', 's', 'd',
             'consumed', now() - interval '29 days', now() - interval '30 days'
        from generate_series(1, 5000) n`;
    await owner.sql`
      insert into assistant_approvals
        (tenant_id, approval_id, conversation_id, tool_call_id, tool, card, created_at)
      select ${tenantId}, a.id, ${seeded.conversationId}, 'old-' || a.id, 'update_role_description',
             '{}'::jsonb, a.created_at
        from agent_approvals a
       where a.tenant_id = ${tenantId} and a.state = 'consumed'
         and not exists (select 1 from assistant_approvals k where k.approval_id = a.id)`;
    await owner.sql`analyze assistant_approvals`;
    await owner.sql`analyze agent_approvals`;

    const statement = new PgDialect().sqlToQuery(pendingCardsStatement(seeded.conversationId, NOW));
    const plan = await app.sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
        `EXPLAIN (FORMAT JSON) ${statement.sql}`,
        statement.params as never[],
      );
      return JSON.stringify(rows[0]?.['QUERY PLAN']);
    });
    expect(plan).toContain('assistant_approvals_recent');
    expect(plan).not.toContain('"Node Type":"Seq Scan"');
  }, 120_000);
});

describe('every method refuses a foreign tenant', () => {
  it('create', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedCard,
      verifySeeded,
      // The row names tenant A's conversation while the connection is bound to B.
      attempt: async (tx, seeded) => {
        const [bound] = await tx.execute<{ tenant: string }>(
          sql`select current_setting('app.tenant_id') as tenant`,
        );
        expect(bound?.tenant).not.toBe(seeded.tenantId);
        try {
          await withTenant(app.db, bound?.tenant ?? '', (own) =>
            approvalCardRepository(own).create({
              approvalId: seeded.approvalId,
              conversationId: seeded.conversationId,
              toolCallId: 'another-call',
              tool: 'update_role_description',
              body: BODY,
            }),
          );
          return null;
        } catch (error) {
          return String(error instanceof Error && error.cause !== undefined ? error.cause : error);
        }
      },
      expectBlocked: (result) => {
        expect(result).not.toBeNull();
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect(
          await approvalCardRepository(tx).byCall(seeded.conversationId, 'another-call'),
        ).toBeUndefined();
      },
    });
  });

  it('byApproval', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedCard,
      verifySeeded,
      attempt: async (tx, seeded) => approvalCardRepository(tx).byApproval(seeded.approvalId),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });

  it('byCall', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedCard,
      verifySeeded,
      attempt: async (tx, seeded) =>
        approvalCardRepository(tx).byCall(seeded.conversationId, seeded.toolCallId),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
    });
  });

  it('forCalls', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedCard,
      verifySeeded,
      attempt: async (tx, seeded) =>
        approvalCardRepository(tx).forCalls(seeded.conversationId, [seeded.toolCallId]),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('pending', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedCard,
      verifySeeded,
      attempt: async (tx, seeded) => approvalCardRepository(tx).pending(seeded.conversationId, NOW),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});
