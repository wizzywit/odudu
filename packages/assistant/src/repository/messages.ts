import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  assistantConversations,
  assistantMessages,
  type MessageRecord,
} from '#/schema/assistant-conversations';
import { type AssistantTx } from '#/repository/tx';

export type { MessageRecord } from '#/schema/assistant-conversations';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface NewMessage {
  role: MessageRole;
  parts: unknown[];
}

// The most messages one read returns. Each message's parts may reach 1 MiB
// (the table's CHECK), so one read holds at most 100 MiB; older messages are
// the compactor's to fold.
export const MAX_LOAD = 100;

export class ConversationNotFoundError extends Error {
  constructor() {
    super('assistant conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

// Another turn wrote to the conversation after this one last did, so what this
// one holds is no longer the end of it.
export class ConversationTailChangedError extends Error {
  constructor() {
    super('the conversation changed since this turn last wrote to it');
    this.name = 'ConversationTailChangedError';
  }
}

// A whole number from 1 to `ceiling`; anything not a number becomes 1.
function boundedLimit(limit: number, ceiling: number): number {
  return Number.isNaN(limit) ? 1 : Math.max(1, Math.min(Math.trunc(limit), ceiling));
}

export function messageRepository(tx: AssistantTx) {
  // Holding the conversation row is what serialises writers: two appends to
  // one conversation queue here, so each reads the sequence the last one left.
  async function lockedTail(conversationId: string): Promise<{ tenantId: string; tail: number }> {
    const [conversation] = await tx
      .select({ tenantId: assistantConversations.tenantId })
      .from(assistantConversations)
      .where(eq(assistantConversations.id, conversationId))
      .for('update');
    if (conversation === undefined) throw new ConversationNotFoundError();
    const [last] = await tx
      .select({ tail: sql<number>`coalesce(max(${assistantMessages.seq}), 0)::int` })
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, conversationId));
    return { tenantId: conversation.tenantId, tail: last?.tail ?? 0 };
  }

  async function insertFrom(
    conversationId: string,
    tenantId: string,
    firstSeq: number,
    messages: readonly NewMessage[],
  ): Promise<number[]> {
    if (messages.length === 0) return [];
    const rows = await tx
      .insert(assistantMessages)
      .values(
        messages.map((message, index) => ({
          tenantId,
          conversationId,
          seq: firstSeq + index,
          role: message.role,
          parts: message.parts,
        })),
      )
      .returning({ seq: assistantMessages.seq });
    return rows.map((row) => row.seq).sort((a, b) => a - b);
  }

  return {
    async append(conversationId: string, message: NewMessage): Promise<number> {
      const { tenantId, tail } = await lockedTail(conversationId);
      const [seq] = await insertFrom(conversationId, tenantId, tail + 1, [message]);
      if (seq === undefined) throw new Error('the message insert returned no row');
      return seq;
    },

    // Rewrites `seq` in place, only while it is still the conversation's last
    // message. The check and the write hold the conversation row, so a turn on
    // another server that has appended since is never overwritten or cut off:
    // this one fails instead, and both turns' messages stay.
    async replaceLast(
      conversationId: string,
      seq: number,
      message: NewMessage,
      // The parts the caller last read or wrote: the row is rewritten only while it
      // still holds them, so a turn on another server that rewrote it first is not undone.
      expected?: readonly unknown[],
    ): Promise<number> {
      const { tail } = await lockedTail(conversationId);
      if (tail !== seq) throw new ConversationTailChangedError();
      if (expected !== undefined) {
        const held = await tx.execute(sql`
          select 1 from assistant_messages
           where conversation_id = ${conversationId} and seq = ${seq}
             and parts = ${JSON.stringify(expected)}::jsonb`);
        if (held.length === 0) throw new ConversationTailChangedError();
      }
      await tx
        .update(assistantMessages)
        .set({ role: message.role, parts: message.parts })
        .where(
          and(eq(assistantMessages.conversationId, conversationId), eq(assistantMessages.seq, seq)),
        );
      return seq;
    },

    // The conversation's first message, which a long conversation's latest
    // `load` no longer reaches.
    async first(conversationId: string): Promise<MessageRecord | undefined> {
      const [row] = await tx
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conversationId))
        .orderBy(assistantMessages.seq)
        .limit(1);
      return row;
    },

    // The latest `limit` messages, oldest first, never more than MAX_LOAD.
    async load(conversationId: string, limit: number): Promise<MessageRecord[]> {
      const rows = await tx
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conversationId))
        .orderBy(desc(assistantMessages.seq))
        .limit(boundedLimit(limit, MAX_LOAD));
      return rows.reverse();
    },

    // Drops every message from `fromSeq` on and writes `messages` in their
    // place, numbered from `fromSeq`; returns the numbers written.
    async replaceTail(
      conversationId: string,
      fromSeq: number,
      messages: readonly NewMessage[],
    ): Promise<number[]> {
      const { tenantId, tail } = await lockedTail(conversationId);
      if (fromSeq < 1 || fromSeq > tail + 1) {
        throw new Error(
          `replacing from ${String(fromSeq)} would leave a gap after ${String(tail)}`,
        );
      }
      await tx
        .delete(assistantMessages)
        .where(
          and(
            eq(assistantMessages.conversationId, conversationId),
            gte(assistantMessages.seq, fromSeq),
          ),
        );
      return insertFrom(conversationId, tenantId, fromSeq, messages);
    },
  };
}
