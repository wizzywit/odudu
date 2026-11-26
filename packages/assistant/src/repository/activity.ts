// Reads for the activity list and the replay, over a tenant's conversations,
// turns, steps, events and approval cards. Every statement names the tenant the
// transaction is bound to, so each is served from that tenant's rows by the key
// beside it, and the table policies hold the same line.
import type { AssistantActivityKind, AssistantStopReason } from '@odudu/contracts/admin';
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';
import type {
  ActivityConversationRow,
  ActivityPosition,
  ApprovalRow,
  AskedRow,
  EventRow,
  SlotTokens,
  StepRow,
  TurnAggregate,
  TurnRow,
} from '#/service/activity-rows';

export type {
  ActivityConversationRow,
  ActivityPosition,
  ApprovalRow,
  AskedRow,
  EventRow,
  SlotTokens,
  StepRow,
  TurnAggregate,
  TurnRow,
} from '#/service/activity-rows';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

// The most conversations one request looks at to fill a filtered page. A page
// that these do not fill is returned short with a cursor to carry on from.
export const ACTIVITY_SCAN_MAX = 1_000;

export interface ActivityFilters {
  readonly person?: string | undefined;
  readonly conversation?: string | undefined;
  readonly tool?: string | undefined;
  readonly outcome?: AssistantStopReason | undefined;
  readonly kind?: AssistantActivityKind | undefined;
}

interface ConversationRow extends Record<string, unknown> {
  id: string;
  owner_subject_id: string;
  profile: string;
  mode: string;
  title: string | null;
  created_at: Date | string;
  last_active_at: Date | string;
  reported_at: Date | string | null;
  last_active_text: string;
  hit?: boolean;
}

const BUDGET_STOPS = ['budget_turn', 'budget_conversation', 'budget_admin', 'budget_tenant'];

function turnsOf(): SQL {
  return sql`t.tenant_id = c.tenant_id and t.conversation_id = c.id`;
}

interface Probe {
  /** A lateral subquery named `alias` that reads one value for the conversation `c`. */
  readonly join: SQL;
  /** What the value must be for the conversation to count. */
  readonly hit: SQL;
}

// The filters that look inside a conversation. Each is a lateral subquery with
// a limit, which Postgres runs once for each conversation scanned, by the keys
// of the turns, events or cards of that one conversation. A plain EXISTS would
// be turned into a hash of every matching row of the tenant instead.
function probes(filters: ActivityFilters): Probe[] {
  const found: Probe[] = [];
  const add = (body: SQL, hit: (alias: SQL) => SQL): void => {
    const alias = sql.raw(`p${String(found.length)}`);
    found.push({
      join: sql`left join lateral (${body}) ${alias} on true`,
      hit: hit(sql`${alias}.x`),
    });
  };
  const present = (alias: SQL): SQL => sql`${alias} is not null`;
  if (filters.tool !== undefined) {
    add(
      sql`select 1 as x from assistant_turns t
            join assistant_events e
              on e.tenant_id = t.tenant_id and e.turn_id = t.id
             and e.kind = 'tool_call' and e.payload ->> 'tool' = ${filters.tool}
           where ${turnsOf()} limit 1`,
      present,
    );
  }
  if (filters.outcome !== undefined) {
    add(
      sql`select t.stop_reason as x from assistant_turns t
           where ${turnsOf()} order by t.started_at desc, t.id desc limit 1`,
      (alias) => sql`${alias} = ${filters.outcome}`,
    );
  }
  if (filters.kind === 'approval') {
    add(
      sql`select 1 as x from assistant_approvals a
           where a.tenant_id = c.tenant_id and a.conversation_id = c.id limit 1`,
      present,
    );
  } else if (filters.kind === 'budget_refusal') {
    add(
      sql`select 1 as x from assistant_turns t
           where ${turnsOf()}
             and t.stop_reason in (${sql.join(
               BUDGET_STOPS.map((stop) => sql`${stop}`),
               sql`, `,
             )}) limit 1`,
      present,
    );
  } else if (filters.kind === 'tool_error') {
    add(
      sql`select 1 as x from assistant_turns t
            join assistant_events e
              on e.tenant_id = t.tenant_id and e.turn_id = t.id and e.kind = 'tool_error'
           where ${turnsOf()} limit 1`,
      present,
    );
  }
  return found;
}

export function hasDeepFilter(filters: ActivityFilters): boolean {
  return probes(filters).length > 0;
}

const COLUMNS = sql`
  c.tenant_id, c.id, c.owner_subject_id, c.profile, c.mode, c.title, c.created_at,
  c.last_active_at, c.reported_at, c.last_active_at::text as last_active_text`;

/**
 * The conversations of the tenant newest activity first, after `after`, at most
 * `scan` of them. The conversation, person and position predicates are served by
 * the activity indexes; a filter that looks inside a conversation is tried on each
 * one scanned and reported as `hit`, so the work is the scan and not the table.
 */
export function activityPageStatement(
  filters: ActivityFilters,
  after: ActivityPosition | undefined,
  scan: number,
): SQL {
  const predicates: SQL[] = [sql`c.tenant_id = ${TENANT}`];
  if (filters.person !== undefined) predicates.push(sql`c.owner_subject_id = ${filters.person}`);
  if (filters.conversation !== undefined) predicates.push(sql`c.id = ${filters.conversation}`);
  if (after !== undefined) {
    predicates.push(
      sql`(c.last_active_at, c.id) < (${after.lastActiveAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const scanned = sql`
    select ${COLUMNS}
      from assistant_conversations c
     where ${sql.join(predicates, sql` and `)}
     order by c.last_active_at desc, c.id desc
     limit ${scan}`;
  const found = probes(filters);
  if (found.length === 0) {
    return sql`
      select s.*, true as hit from (${scanned}) s
       order by s.last_active_at desc, s.id desc`;
  }
  return sql`
    select c.*, ${sql.join(
      found.map((probe) => probe.hit),
      sql` and `,
    )} as hit
      from (${scanned}) c
      ${sql.join(
        found.map((probe) => probe.join),
        sql` `,
      )}
     order by c.last_active_at desc, c.id desc`;
}

function toRow(row: ConversationRow): ActivityConversationRow {
  return {
    id: row.id,
    ownerSubjectId: row.owner_subject_id,
    profile: row.profile,
    mode: row.mode,
    title: row.title,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
    reportedAt: row.reported_at === null ? null : new Date(row.reported_at),
    position: { lastActiveAt: row.last_active_text, id: row.id },
  };
}

export interface ActivityPage {
  readonly items: ActivityConversationRow[];
  readonly next: ActivityPosition | null;
}

const idList = (ids: readonly string[]): SQL =>
  sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

const date = (value: Date | string): Date => new Date(value);
const dateOrNull = (value: Date | string | null): Date | null =>
  value === null ? null : new Date(value);

export function activityRepository(tx: AssistantTx) {
  return {
    /**
     * One page: at most `limit` conversations. A filter that looks inside a
     * conversation is tried on at most ACTIVITY_SCAN_MAX of them, so the page may
     * hold fewer than `limit`, or none, and still carry a cursor to resume from.
     */
    async page(
      filters: ActivityFilters,
      after: ActivityPosition | undefined,
      limit: number,
    ): Promise<ActivityPage> {
      const deep = hasDeepFilter(filters);
      const scan = deep ? ACTIVITY_SCAN_MAX : limit + 1;
      const rows = await tx.execute<ConversationRow>(activityPageStatement(filters, after, scan));
      const hits = rows.filter((row) => row.hit === true);
      const items = hits.slice(0, limit).map(toRow);
      const last = items[items.length - 1];
      if (hits.length > limit && last !== undefined) return { items, next: last.position };
      const edge = rows[rows.length - 1];
      if (deep && rows.length === scan && edge !== undefined) {
        return { items, next: toRow(edge).position };
      }
      return { items, next: null };
    },

    async byId(id: string): Promise<ActivityConversationRow | undefined> {
      const rows = await tx.execute<ConversationRow>(sql`
        select ${COLUMNS} from assistant_conversations c
         where c.tenant_id = ${TENANT} and c.id = ${id}`);
      const [row] = rows;
      return row === undefined ? undefined : toRow(row);
    },

    /** Turn counts and the latest turn's stop reason, for the conversations of a page. */
    async turnAggregates(ids: readonly string[]): Promise<Map<string, TurnAggregate>> {
      if (ids.length === 0) return new Map();
      const rows = await tx.execute<{
        conversation_id: string;
        turns: number;
        last_stop: string | null;
      }>(sql`
        select t.conversation_id, count(*)::int as turns,
               (array_agg(t.stop_reason order by t.started_at desc, t.id desc))[1] as last_stop
          from assistant_turns t
         where t.tenant_id = ${TENANT} and t.conversation_id = any(${idList(ids)})
         group by t.conversation_id`);
      return new Map(
        rows.map((row) => [row.conversation_id, { turns: row.turns, lastStop: row.last_stop }]),
      );
    },

    /** Steps and tokens by slot, for the conversations of a page. */
    async slotTokens(ids: readonly string[]): Promise<Map<string, SlotTokens>> {
      if (ids.length === 0) return new Map();
      const rows = await tx.execute<{
        conversation_id: string;
        slot: string;
        steps: number;
        tokens: string | number;
      }>(sql`
        select t.conversation_id, s.slot, count(*)::int as steps,
               coalesce(sum(coalesce(s.input_tokens, 0) + coalesce(s.output_tokens, 0)), 0)::bigint as tokens
          from assistant_steps s
          join assistant_turns t on t.tenant_id = s.tenant_id and t.id = s.turn_id
         where s.tenant_id = ${TENANT} and t.conversation_id = any(${idList(ids)})
         group by t.conversation_id, s.slot`);
      const found = new Map<string, { steps: number; tokens: Record<string, number> }>();
      for (const row of rows) {
        const entry = found.get(row.conversation_id) ?? { steps: 0, tokens: {} };
        entry.steps += row.steps;
        entry.tokens[row.slot] = Number(row.tokens);
        found.set(row.conversation_id, entry);
      }
      return found;
    },

    /** The distinct tools each conversation of a page called, by the tool-call index. */
    async toolNames(ids: readonly string[], cap: number): Promise<Map<string, string[]>> {
      if (ids.length === 0) return new Map();
      const rows = await tx.execute<{ conversation_id: string; tools: string[] }>(sql`
        select t.conversation_id,
               (array_agg(distinct e.payload ->> 'tool'))[1:${cap}] as tools
          from assistant_events e
          join assistant_turns t on t.tenant_id = e.tenant_id and t.id = e.turn_id
         where e.tenant_id = ${TENANT} and e.kind = 'tool_call'
           and e.payload ->> 'tool' ~ '^[a-z][a-z0-9_]{0,63}$'
           and t.conversation_id = any(${idList(ids)})
         group by t.conversation_id`);
      return new Map(rows.map((row) => [row.conversation_id, row.tools]));
    },

    async approvalCounts(ids: readonly string[]): Promise<Map<string, number>> {
      if (ids.length === 0) return new Map();
      const rows = await tx.execute<{ conversation_id: string; approvals: number }>(sql`
        select a.conversation_id, count(*)::int as approvals
          from assistant_approvals a
         where a.tenant_id = ${TENANT} and a.conversation_id = any(${idList(ids)})
         group by a.conversation_id`);
      return new Map(rows.map((row) => [row.conversation_id, row.approvals]));
    },

    /** The conversation's latest turns, newest first, and how many there are in all. */
    async latestTurns(
      conversationId: string,
      limit: number,
    ): Promise<{ turns: TurnRow[]; total: number }> {
      const rows = await tx.execute<{
        id: string;
        profile: string;
        prompt_hash: string;
        started_at: Date | string;
        ended_at: Date | string | null;
        stop_reason: string | null;
      }>(sql`
        select id, profile, prompt_hash, started_at, ended_at, stop_reason
          from assistant_turns
         where tenant_id = ${TENANT} and conversation_id = ${conversationId}
         order by started_at desc, id desc
         limit ${limit}`);
      const counted = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from assistant_turns
         where tenant_id = ${TENANT} and conversation_id = ${conversationId}`);
      return {
        turns: rows.map((row) => ({
          id: row.id,
          profile: row.profile,
          promptHash: row.prompt_hash,
          startedAt: date(row.started_at),
          endedAt: dateOrNull(row.ended_at),
          stopReason: row.stop_reason,
        })),
        total: counted[0]?.n ?? 0,
      };
    },

    async stepsOf(turnIds: readonly string[]): Promise<StepRow[]> {
      if (turnIds.length === 0) return [];
      const rows = await tx.execute<{
        id: string;
        turn_id: string;
        parent_step_id: string | null;
        slot: string;
        model: string;
        provider_request_id: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
        started_at: Date | string;
        ended_at: Date | string | null;
      }>(sql`
        select id, turn_id, parent_step_id, slot, model, provider_request_id,
               input_tokens, output_tokens, started_at, ended_at
          from assistant_steps
         where tenant_id = ${TENANT} and turn_id = any(${idList(turnIds)})
         order by turn_id, started_at, id`);
      return rows.map((row) => ({
        id: row.id,
        turnId: row.turn_id,
        parentStepId: row.parent_step_id,
        slot: row.slot,
        model: row.model,
        providerRequestId: row.provider_request_id,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        startedAt: date(row.started_at),
        endedAt: dateOrNull(row.ended_at),
      }));
    },

    async eventsOf(turnIds: readonly string[]): Promise<EventRow[]> {
      if (turnIds.length === 0) return [];
      const rows = await tx.execute<{
        turn_id: string;
        seq: number;
        step_id: string | null;
        kind: string;
        payload: unknown;
        at: Date | string;
      }>(sql`
        select turn_id, seq, step_id, kind, payload, at
          from assistant_events
         where tenant_id = ${TENANT} and turn_id = any(${idList(turnIds)})
         order by turn_id, seq`);
      return rows.map((row) => ({
        turnId: row.turn_id,
        seq: row.seq,
        stepId: row.step_id,
        kind: row.kind,
        payload: row.payload,
        at: date(row.at),
      }));
    },

    /** The conversation's cards with the decision each approval holds, newest first. */
    async approvalsOf(conversationId: string, limit: number): Promise<ApprovalRow[]> {
      const rows = await tx.execute<{
        approval_id: string;
        conversation_id: string;
        tool_call_id: string;
        tool: string;
        card: unknown;
        state: string;
        created_at: Date | string;
        decided_at: Date | string | null;
        decided_via: string | null;
      }>(sql`
        select c.approval_id, c.conversation_id, c.tool_call_id, c.tool, c.card, a.state,
               c.created_at, a.decided_at, a.decided_via
          from assistant_approvals c
          join agent_approvals a on a.id = c.approval_id
         where c.tenant_id = ${TENANT} and c.conversation_id = ${conversationId}
         order by c.created_at desc, c.approval_id desc
         limit ${limit}`);
      return rows.map((row) => ({
        id: row.approval_id,
        conversationId: row.conversation_id,
        toolCallId: row.tool_call_id,
        tool: row.tool,
        card: row.card,
        state: row.state,
        createdAt: date(row.created_at),
        decidedAt: dateOrNull(row.decided_at),
        decidedVia: row.decided_via,
      }));
    },

    /** The latest messages the person sent, oldest first. */
    async askedOf(conversationId: string, limit: number): Promise<AskedRow[]> {
      const rows = await tx.execute<{
        seq: number;
        created_at: Date | string;
        parts: unknown;
      }>(sql`
        select seq, created_at, parts from assistant_messages
         where tenant_id = ${TENANT} and conversation_id = ${conversationId} and role = 'user'
         order by seq desc
         limit ${limit}`);
      return rows
        .map((row) => ({ seq: row.seq, createdAt: date(row.created_at), parts: row.parts }))
        .reverse();
    },

    /**
     * Marks the conversation reported, once: the number of reported conversations is
     * counted under a lock on the tenant, so two reports cannot both take the last
     * place. `already` for one reported before, `full` at the cap, `missing` for one
     * that is not here.
     */
    async report(
      conversationId: string,
      now: Date,
      cap: number,
    ): Promise<
      | { kind: 'reported'; at: Date; count: number }
      | { kind: 'already'; at: Date; count: number }
      | { kind: 'full' }
      | { kind: 'missing' }
    > {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('assistant-report:' || ${TENANT}::text, 0))`,
      );
      const found = await tx.execute<{ reported_at: Date | string | null }>(sql`
        select reported_at from assistant_conversations
         where tenant_id = ${TENANT} and id = ${conversationId}`);
      const [row] = found;
      if (row === undefined) return { kind: 'missing' };
      const counted = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from assistant_conversations
         where tenant_id = ${TENANT} and reported_at is not null`);
      const count = counted[0]?.n ?? 0;
      if (row.reported_at !== null) return { kind: 'already', at: date(row.reported_at), count };
      if (count >= cap) return { kind: 'full' };
      await tx.execute(sql`
        update assistant_conversations set reported_at = ${now.toISOString()}::timestamptz
         where tenant_id = ${TENANT} and id = ${conversationId}`);
      return { kind: 'reported', at: now, count: count + 1 };
    },
  };
}
