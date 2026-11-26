// What the retention pass deletes, in bounded batches found through an index:
// turns (with their steps and events, by cascade), approval cards and idle
// conversations (with their messages). A conversation a person reported is
// never deleted, and neither is anything under it.
import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

const notReported = (alias: string, column: string): SQL => sql`not exists (
  select 1 from assistant_conversations c
   where c.tenant_id = ${sql.raw(alias)}.tenant_id
     and c.id = ${sql.raw(alias)}.${sql.raw(column)}
     and c.reported_at is not null)`;

// The oldest turns first, through assistant_turns_started. The reported
// conversations' own turns are skipped, and there are at most as many of those
// as the cap on reported conversations allows.
export function pruneTurnsStatement(before: Date, batch: number): SQL {
  return sql`
    delete from assistant_turns
     where ctid in (
       select t.ctid from assistant_turns t
        where t.tenant_id = ${TENANT}
          and t.started_at < ${before.toISOString()}::timestamptz
          and ${notReported('t', 'conversation_id')}
        order by t.started_at
        limit ${batch})`;
}

export function pruneCardsStatement(before: Date, batch: number): SQL {
  return sql`
    delete from assistant_approvals
     where ctid in (
       select a.ctid from assistant_approvals a
        where a.tenant_id = ${TENANT}
          and a.created_at < ${before.toISOString()}::timestamptz
          and ${notReported('a', 'conversation_id')}
        order by a.created_at
        limit ${batch})`;
}

// Through assistant_conversations_idle, which holds only the unreported.
export function pruneConversationsStatement(before: Date, batch: number): SQL {
  return sql`
    delete from assistant_conversations
     where ctid in (
       select c.ctid from assistant_conversations c
        where c.tenant_id = ${TENANT}
          and c.reported_at is null
          and c.last_active_at < ${before.toISOString()}::timestamptz
        order by c.last_active_at
        limit ${batch})`;
}

export function retentionRepository(tx: AssistantTx) {
  return {
    /** The tenant's days of trace, or the default for one that never chose. */
    async days(): Promise<number> {
      const rows = await tx.execute<{ days: number }>(sql`
        select assistant_trace_retention_days as days
          from assistant_settings where tenant_id = ${TENANT}`);
      return rows[0]?.days ?? ASSISTANT_SETTING_DEFAULTS.assistant_trace_retention_days;
    },

    async pruneTurns(before: Date, batch: number): Promise<number> {
      return (await tx.execute(pruneTurnsStatement(before, batch))).count;
    },

    async pruneCards(before: Date, batch: number): Promise<number> {
      return (await tx.execute(pruneCardsStatement(before, batch))).count;
    },

    async pruneConversations(before: Date, batch: number): Promise<number> {
      return (await tx.execute(pruneConversationsStatement(before, batch))).count;
    },
  };
}
