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

// A conversation bound to another tenant ends its trace by the stricter of the
// two tenants' windows. The statements below take that target when they serve
// one: they walk the conversations bound to it through assistant_conversations_target
// and reach the turns and cards through the conversation's own keys.

// The oldest turns first, through assistant_turns_started. The turns of a
// reported conversation are skipped, and each round reads them again: the cost
// is those turns, however many a reported conversation has.
export function pruneTurnsStatement(before: Date, batch: number, target?: string): SQL {
  if (target !== undefined) {
    return sql`
      delete from assistant_turns
       where ctid in (
         select t.ctid from assistant_conversations c
           join assistant_turns t on t.tenant_id = c.tenant_id and t.conversation_id = c.id
          where c.tenant_id = ${TENANT} and c.target_tenant_id = ${target}
            and c.reported_at is null
            and t.started_at < ${before.toISOString()}::timestamptz
          limit ${batch})`;
  }
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

export function pruneCardsStatement(before: Date, batch: number, target?: string): SQL {
  if (target !== undefined) {
    return sql`
      delete from assistant_approvals
       where ctid in (
         select a.ctid from assistant_conversations c
           join assistant_approvals a
             on a.tenant_id = c.tenant_id and a.conversation_id = c.id
          where c.tenant_id = ${TENANT} and c.target_tenant_id = ${target}
            and c.reported_at is null
            and a.created_at < ${before.toISOString()}::timestamptz
          limit ${batch})`;
  }
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

// Through assistant_conversations_idle, which holds only the unreported; for a
// target, through assistant_conversations_target.
export function pruneConversationsStatement(before: Date, batch: number, target?: string): SQL {
  const bound = target === undefined ? sql`` : sql`and c.target_tenant_id = ${target}`;
  return sql`
    delete from assistant_conversations
     where ctid in (
       select c.ctid from assistant_conversations c
        where c.tenant_id = ${TENANT}
          and c.reported_at is null
          ${bound}
          and c.last_active_at < ${before.toISOString()}::timestamptz
        order by c.last_active_at
        limit ${batch})
       and reported_at is null`;
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

    /**
     * One page of the tenants this tenant's conversations are bound to, in id
     * order, after `after`: at most `limit`. Through
     * assistant_conversations_target, which holds only bound conversations, so
     * the cost follows those and not the table.
     */
    async targets(after: string | undefined, limit: number): Promise<string[]> {
      const rows = await tx.execute<{ target_tenant_id: string }>(sql`
        select distinct c.target_tenant_id from assistant_conversations c
         where c.tenant_id = ${TENANT} and c.target_tenant_id is not null
           ${after === undefined ? sql`` : sql`and c.target_tenant_id > ${after}`}
         order by c.target_tenant_id
         limit ${limit}`);
      return rows.map((row) => row.target_tenant_id);
    },

    async pruneTurns(before: Date, batch: number, target?: string): Promise<number> {
      return (await tx.execute(pruneTurnsStatement(before, batch, target))).count;
    },

    async pruneCards(before: Date, batch: number, target?: string): Promise<number> {
      return (await tx.execute(pruneCardsStatement(before, batch, target))).count;
    },

    async pruneConversations(before: Date, batch: number, target?: string): Promise<number> {
      return (await tx.execute(pruneConversationsStatement(before, batch, target))).count;
    },
  };
}
