import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// What stays of a conversation its owner deleted. The foreign keys (to tenants
// and the owner), the checks and the policy live in packages/db/drizzle/0157;
// the assistant package imports no database package, so nothing here references
// one.
export const assistantConversationTombstones = pgTable(
  'assistant_conversation_tombstones',
  {
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    ownerSubjectId: uuid('owner_subject_id').notNull(),
    targetTenantId: uuid('target_tenant_id'),
    profile: text('profile').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull(),
    deletedBySubjectId: uuid('deleted_by_subject_id').notNull(),
    messageCount: integer('message_count').notNull(),
    turnCount: integer('turn_count').notNull(),
    digest: text('digest').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.conversationId] })],
).enableRLS();

export type ConversationTombstone = typeof assistantConversationTombstones.$inferSelect;
