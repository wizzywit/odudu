// The cards of a conversation's pending changes, read together with the state
// and expiry of the P5 approval each belongs to. The decision itself is never
// written here: `decideApproval` is its only writer.
import {
  assistantApprovalCardSchema,
  CONVERSATION_APPROVALS_MAX,
  type AssistantApprovalCard,
} from '@odudu/contracts/admin';
import { sql, type SQL } from 'drizzle-orm';
import { type AssistantTx } from '#/repository/tx';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

// What the person is shown, minus what the rows around it supply.
export const cardBodySchema = assistantApprovalCardSchema.pick({
  title: true,
  target: true,
  before: true,
  after: true,
});
export type CardBody = Pick<AssistantApprovalCard, 'title' | 'target' | 'before' | 'after'>;

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

export interface ApprovalCardRow {
  readonly approvalId: string;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly body: CardBody;
  readonly state: ApprovalState;
  readonly expiresAt: Date;
}

type Row = {
  approval_id: string;
  conversation_id: string;
  tool_call_id: string;
  tool: string;
  card: unknown;
  state: ApprovalState;
  expires_at: Date | string;
};

function toRow(row: Row): ApprovalCardRow {
  return {
    approvalId: row.approval_id,
    conversationId: row.conversation_id,
    toolCallId: row.tool_call_id,
    tool: row.tool,
    body: cardBodySchema.parse(row.card),
    state: row.state,
    expiresAt: new Date(row.expires_at),
  };
}

// The most tool calls one lookup names: the pending parts of one message.
const MAX_CALLS = 50;

const COLUMNS = sql`
  c.approval_id, c.conversation_id, c.tool_call_id, c.tool, c.card,
  a.state, a.expires_at`;

// The conversation's pending cards, served by the (tenant, conversation) prefix
// of `assistant_approvals_call` and the approval's primary key.
export function pendingCardsStatement(conversationId: string, now: Date): SQL {
  return sql`
    select ${COLUMNS}
      from assistant_approvals c
      join agent_approvals a on a.id = c.approval_id
     where c.tenant_id = ${TENANT} and c.conversation_id = ${conversationId}
       and a.state = 'pending' and a.expires_at > ${now.toISOString()}::timestamptz
     order by c.created_at desc, c.approval_id desc
     limit ${CONVERSATION_APPROVALS_MAX}`;
}

export function approvalCardRepository(tx: AssistantTx) {
  return {
    async create(input: {
      readonly approvalId: string;
      readonly conversationId: string;
      readonly toolCallId: string;
      readonly tool: string;
      readonly body: CardBody;
    }): Promise<void> {
      await tx.execute(sql`
        insert into assistant_approvals
          (tenant_id, approval_id, conversation_id, tool_call_id, tool, card)
        values (${TENANT}, ${input.approvalId}, ${input.conversationId}, ${input.toolCallId},
                ${input.tool}, ${JSON.stringify(input.body)}::jsonb)`);
    },

    // The card of one approval, whichever conversation holds it.
    async byApproval(approvalId: string): Promise<ApprovalCardRow | undefined> {
      const rows = await tx.execute<Row>(sql`
        select ${COLUMNS}
          from assistant_approvals c
          join agent_approvals a on a.id = c.approval_id
         where c.tenant_id = ${TENANT} and c.approval_id = ${approvalId}`);
      const [row] = rows;
      return row === undefined ? undefined : toRow(row);
    },

    // The card for a tool call of a conversation, through the unique index.
    async byCall(conversationId: string, toolCallId: string): Promise<ApprovalCardRow | undefined> {
      const rows = await tx.execute<Row>(sql`
        select ${COLUMNS}
          from assistant_approvals c
          join agent_approvals a on a.id = c.approval_id
         where c.tenant_id = ${TENANT} and c.conversation_id = ${conversationId}
           and c.tool_call_id = ${toolCallId}`);
      const [row] = rows;
      return row === undefined ? undefined : toRow(row);
    },

    // The cards for the named tool calls, at most MAX_CALLS of them.
    async forCalls(
      conversationId: string,
      toolCallIds: readonly string[],
    ): Promise<ApprovalCardRow[]> {
      if (toolCallIds.length === 0) return [];
      const ids = toolCallIds.slice(0, MAX_CALLS);
      const rows = await tx.execute<Row>(sql`
        select ${COLUMNS}
          from assistant_approvals c
          join agent_approvals a on a.id = c.approval_id
         where c.tenant_id = ${TENANT} and c.conversation_id = ${conversationId}
           and c.tool_call_id in (${sql.join(
             ids.map((id) => sql`${id}`),
             sql`, `,
           )})`);
      return rows.map(toRow);
    },

    // The conversation's changes still waiting, newest first: the owner holds
    // at most CONVERSATION_APPROVALS_MAX pending approvals, and the read is
    // bounded by it all the same.
    async pending(conversationId: string, now: Date): Promise<ApprovalCardRow[]> {
      const rows = await tx.execute<Row>(pendingCardsStatement(conversationId, now));
      return rows.map(toRow);
    },
  };
}
