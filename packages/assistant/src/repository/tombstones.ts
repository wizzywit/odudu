import { sql } from 'drizzle-orm';
import { messageRepository, PAGE_MAX } from '#/repository/messages';
import type { ConversationRecord } from '#/repository/conversations';
import { type AssistantTx } from '#/repository/tx';
import { conversationDigest } from '#/service/conversation-digest';

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

export interface Tombstone {
  readonly messageCount: number;
  readonly turnCount: number;
  readonly digest: string;
}

export function tombstoneRepository(tx: AssistantTx) {
  return {
    /**
     * Deletes the conversation its owner holds and leaves a tombstone in its
     * place: the messages are read once, a page at a time, into a keyed digest,
     * the tombstone row is written, and the conversation row is deleted, which
     * takes its messages, turns, steps, events and approval cards with it. The
     * caller holds the conversation's lock (`conversationRepository.lock`), so no
     * message is written between the digest and the delete.
     */
    async erase(
      record: ConversationRecord,
      deletedBy: string,
      now: Date,
      key: Uint8Array,
    ): Promise<Tombstone> {
      const digest = conversationDigest(key, record.tenantId);
      const messages = messageRepository(tx);
      let messageCount = 0;
      let after = 0;
      for (;;) {
        const page = await messages.pageAfter(record.id, after, PAGE_MAX);
        for (const message of page) {
          digest.add({ seq: message.seq, role: message.role, parts: message.parts });
        }
        messageCount += page.length;
        const last = page[page.length - 1];
        if (last === undefined || page.length < PAGE_MAX) break;
        after = last.seq;
      }
      const [counted] = await tx.execute<{ turns: number }>(sql`
        select count(*)::int as turns from assistant_turns
         where tenant_id = ${TENANT} and conversation_id = ${record.id}`);
      const result: Tombstone = {
        messageCount,
        turnCount: counted?.turns ?? 0,
        digest: digest.hex(),
      };
      await tx.execute(sql`
        insert into assistant_conversation_tombstones
          (tenant_id, conversation_id, owner_subject_id, target_tenant_id, profile, created_at,
           last_active_at, deleted_at, deleted_by_subject_id, message_count, turn_count, digest)
        values (${TENANT}, ${record.id}, ${record.ownerSubjectId}, ${record.targetTenantId},
                ${record.profile}, ${record.createdAt.toISOString()}::timestamptz,
                ${record.lastActiveAt.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
                ${deletedBy}, ${result.messageCount}, ${result.turnCount}, ${result.digest})`);
      await tx.execute(sql`
        delete from assistant_conversations where tenant_id = ${TENANT} and id = ${record.id}`);
      return result;
    },

    /** The tombstone left for a conversation, or undefined where it was never deleted. */
    async byConversation(conversationId: string) {
      const rows = await tx.execute<{
        owner_subject_id: string;
        deleted_by_subject_id: string;
        deleted_at: Date | string;
        message_count: number;
        turn_count: number;
        digest: string;
      }>(sql`
        select owner_subject_id, deleted_by_subject_id, deleted_at, message_count, turn_count, digest
          from assistant_conversation_tombstones
         where tenant_id = ${TENANT} and conversation_id = ${conversationId}`);
      const [row] = rows;
      return row === undefined
        ? undefined
        : {
            ownerSubjectId: row.owner_subject_id,
            deletedBySubjectId: row.deleted_by_subject_id,
            deletedAt: new Date(row.deleted_at),
            messageCount: row.message_count,
            turnCount: row.turn_count,
            digest: row.digest,
          };
    },
  };
}
