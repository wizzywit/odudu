import { MAX_LIMIT } from '@odudu/contracts/admin';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { assistantConversations, type ConversationRecord } from '#/schema/assistant-conversations';
import { type AssistantTx } from '#/repository/tx';

export type { ConversationRecord } from '#/schema/assistant-conversations';

export type ConversationMode = 'ask' | 'act';

export interface NewConversation {
  id: string;
  tenantId: string;
  ownerSubjectId: string;
  instanceId: string;
  profile: string;
  mode: ConversationMode;
  now: Date;
}

// Resumes strictly after the row it names, in (last_active_at, id) order.
export interface ConversationCursor {
  lastActiveAt: Date;
  id: string;
}

export interface ConversationPage {
  items: ConversationRecord[];
  next: ConversationCursor | null;
}

export function conversationRepository(tx: AssistantTx) {
  return {
    async create(input: NewConversation): Promise<ConversationRecord> {
      const [row] = await tx
        .insert(assistantConversations)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          ownerSubjectId: input.ownerSubjectId,
          instanceId: input.instanceId,
          profile: input.profile,
          mode: input.mode,
          createdAt: input.now,
          lastActiveAt: input.now,
        })
        .returning();
      if (row === undefined) throw new Error('the conversation insert returned no row');
      return row;
    },

    async byId(id: string): Promise<ConversationRecord | undefined> {
      const [row] = await tx
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, id))
        .limit(1);
      return row;
    },

    // One person's conversations, newest first. The limit is bounded at
    // MAX_LIMIT whatever the caller passes; one extra row says whether a
    // further page exists.
    async listByOwner(
      owner: string,
      cursor: ConversationCursor | null,
      limit: number,
    ): Promise<ConversationPage> {
      const size = Number.isNaN(limit) ? 1 : Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
      const after =
        cursor === null
          ? undefined
          : or(
              lt(assistantConversations.lastActiveAt, cursor.lastActiveAt),
              and(
                eq(assistantConversations.lastActiveAt, cursor.lastActiveAt),
                lt(assistantConversations.id, cursor.id),
              ),
            );
      const rows = await tx
        .select()
        .from(assistantConversations)
        .where(and(eq(assistantConversations.ownerSubjectId, owner), after))
        .orderBy(desc(assistantConversations.lastActiveAt), desc(assistantConversations.id))
        .limit(size + 1);
      const items = rows.slice(0, size);
      const last = items[items.length - 1];
      return {
        items,
        next:
          rows.length > size && last !== undefined
            ? { lastActiveAt: last.lastActiveAt, id: last.id }
            : null,
      };
    },

    async touch(id: string, now: Date): Promise<boolean> {
      const rows = await tx
        .update(assistantConversations)
        .set({
          lastActiveAt: sql`greatest(${assistantConversations.lastActiveAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(eq(assistantConversations.id, id))
        .returning({ id: assistantConversations.id });
      return rows.length > 0;
    },

    async setMode(id: string, mode: ConversationMode): Promise<boolean> {
      const rows = await tx
        .update(assistantConversations)
        .set({ mode })
        .where(eq(assistantConversations.id, id))
        .returning({ id: assistantConversations.id });
      return rows.length > 0;
    },
  };
}
