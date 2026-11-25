import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies and the composite foreign keys (to tenants, subjects and, for a
// message, its conversation) live in packages/db/drizzle/0147; the assistant
// package imports no database package, so nothing here references one.
export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    ownerSubjectId: uuid('owner_subject_id').notNull(),
    instanceId: uuid('instance_id').notNull(),
    profile: text('profile').notNull(),
    mode: text('mode').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
).enableRLS();

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    parts: jsonb('parts').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.conversationId, table.seq] })],
).enableRLS();

export type ConversationRecord = typeof assistantConversations.$inferSelect;
export type MessageRecord = typeof assistantMessages.$inferSelect;
